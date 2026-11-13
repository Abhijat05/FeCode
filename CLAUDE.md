# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # install all workspaces
npm run build             # build shared -> models -> agent -> cli, in that order (required before tests; vitest's pretest hook runs it automatically)
npm run dev                # launch the CLI via tsx (apps/cli), same as `npm run fe`
npm run typecheck           # tsc --noEmit, strict mode across the monorepo
npm run lint                # tsc --noEmit && eslint .
npm test                     # vitest run across all workspaces (packages/*, apps/*)
npm run coverage               # vitest run --coverage
```

Run a single test file or suite with `npx vitest run <path>`, e.g.:
```bash
npx vitest run packages/agent/src/test/v1Acceptance.test.ts        # end-to-end acceptance scenarios
npx vitest run packages/agent/src/test/v1SecurityInvariants.test.ts # security invariant tests
npx vitest run apps/cli/src/rcScenarios.test.tsx                     # CLI release-candidate scenarios
npx vitest run apps/cli/src/packaging.test.ts                        # tarball/packaging invariants
```
Vitest is configured per-workspace (`vitest.workspace.js` → `packages/*`, `apps/*`); test env sets `FECODE_HISTORY_DIR` to a tmp dir so tests never touch the real `~/.fecode/history`.

Lint/typecheck are strict: `noUnusedLocals`, `noUnusedParameters`, and `@typescript-eslint/no-explicit-any` are errors, not warnings. A PR is expected to pass typecheck + lint + build + full test suite (mirrors `.github/workflows/ci.yml`).

## Architecture

FeCode is an Ink/React terminal coding agent built as an npm-workspace monorepo with one-directional dependencies:

```
apps/cli  →  packages/agent  →  packages/models  →  packages/shared
```

- **`apps/cli`** — Ink/React TUI, slash commands, approval prompts. Pure presentation; talks to the agent only through `ProductRuntime`.
- **`packages/agent`** — all orchestration: planning, risk assessment, checkpoints, approval handoff, recovery/resume, run history, background tasks, skills.
- **`packages/models`** — provider-agnostic model abstraction (Gemini, OpenAI, Ollama, generic OpenAI-compatible) plus the tool executor and permission policy.
- **`packages/shared`** — common types, ID utilities, config loading.

### The execution boundary is the thing to understand first

Every mutating action (file write/edit/delete, `execute_command`) is required to pass through one fixed pipeline — there is intentionally no other path from a model tool-call to the filesystem/shell:

```
CLI → ProductRuntime → AgentRuntime → PlanExecutor → ExecutionHandoffManager
    → TaskRiskPolicy (risk can only escalate, never downgrade)
    → detectPlanStaleness (branch/file-drift check)
    → CheckpointManager (create + request single-use approval)
    → InteractiveApprovalResolver (explicit user y/n)
    → PermissionManager (tool-level permission check)
    → CheckpointManager.consume() (atomic, single-use)
    → ToolExecutor.execute()
```

`ExecutionHandoffManager` is the authoritative chokepoint for this — any new tool or execution path must be wired through it, not around it. When touching planning, recovery, resume, or replan code, check that it still funnels into this same handoff rather than growing a parallel execution route.

Key invariants enforced across this pipeline (tests in `packages/agent/src/test/v1SecurityInvariants.test.ts` and `v1Acceptance.test.ts` exist specifically to pin these down):
- **Approval types are isolated** — plan approval, step/checkpoint approval, tool-permission approval, recovery approval, continuation approval, and replan approval are distinct; none satisfies another.
- **Checkpoints are single-use and non-transferable** — cannot be consumed twice, across plans, or across runs (incl. resumed runs); they TTL out (5 min default) and are invalidated by branch/file drift.
- **Risk never downgrades** — a step's risk level (`low`/`normal`/`elevated`/`critical`) assessed at plan time can only be escalated at execution time, never reduced.
- **Destructive operations** (`delete_file`/`remove`/`wipe`/`purge`/`drop`/`destroy`) always require explicit approval and are never auto-retried.
- **Resumed runs get a fresh identity** — new `runId`, `parentRunId` lineage preserved, but zero inherited approvals/checkpoints/permissions; a `completed` run cannot be resumed.
- **All approval prompts default to deny** on empty/invalid input or Ctrl+C.
- Secrets (API keys/tokens) are redacted before anything is persisted to run history/telemetry.

### Plan lifecycle

`TaskPlan`: `draft → ready → approved → executing → (blocked ↔ executing | superseded | cancelled/failed) → completed`. Steps are typed (`inspect/analyze/modify/configure/test/verify`) with explicit `dependencies`; a failed prerequisite cascades dependents to `skipped`. `PlanExecutor` re-runs `detectPlanStaleness` before every step (missing target files, branch change, external file modification) and blocks execution on drift rather than silently proceeding. Replanning (`ReplanManager`) is always user-gated and depth-bounded (max 5), tracked via `parentPlanId`/`rootPlanId`/`replanDepth`.

### Provider layer

`packages/models` exposes one streaming interface over Gemini/OpenAI/Ollama/openai-compatible. Optional auto-fallback (`FE_AUTO_FALLBACK=true`) switches providers only on quota/rate-limit errors (not on auth errors, bad requests, or user cancellation), bounded by `FE_MAX_RETRIES_PER_PROVIDER` and `FE_MAX_FALLBACK_SWITCHES`, and is blocked from switching once a tool call has actually dispatched in the current turn (to avoid duplicate side effects). Provider selection/model/keys are read via `FE_PROVIDER`, `FE_MODEL`, and provider-specific env vars (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OLLAMA_BASE_URL`); see `docs/v1/configuration.md` for the full precedence order.

### Skills

`packages/agent/src/skills` loads `SKILL.md` packages (YAML frontmatter + structured markdown sections: activation conditions, workflow, rules, anti-patterns, examples) to inject deterministic, framework-specific guidance. Project framework/tooling detection (`ProjectDetector`) is filesystem-based and LLM-free, used to decide which skills activate.

### Further reading

`docs/v1/*.md` covers each subsystem in more depth (architecture, security-model, risk-levels, approvals-permissions, planning, recovery, replanning, checkpoints, resume, diagnostics, configuration, cli-usage). `CONTRIBUTING.md` has the PR quality-gate list and branch/commit conventions.
