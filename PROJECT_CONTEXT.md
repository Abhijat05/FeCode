# FeCode — Project Context

Compiled from `docs.zip` (`docs/v1/`, `docs/superpowers/{specs,plans}/`, `docs/audit/`) plus a direct security/quality review of the cloned source at `/home/garv/FeCode`. Last compiled: 2026-10-10.

---

## 1. What FeCode Is

FeCode is an **interactive, terminal-native AI coding assistant** (Ink/React TUI), positioned as a "safety-first, plan-driven" alternative to direct-execution agents. Its defining design choice: every mutating action is forced through an explicit lifecycle —

```
Prompt → Plan → Risk Assessment → Approval Gate → Execution Handoff → Verification
```

— rather than a model emitting a shell command or file edit that executes immediately. Version baseline at time of this review: **v1.0.0** (GA), with v1.0.1–v1.0.3+ hardening fixes layered on top per the audit trail below.

- **License**: MIT. **Binaries**: `fe`, `fecode`.
- **Runtime**: Node.js ≥ 20, npm ≥ 10, TypeScript (strict, 5.7+), Ink/React terminal UI.
- **Monorepo layout** (npm workspaces):
  ```
  apps/cli          Ink/React terminal UI, slash commands, approval presentation
        │
        ▼
  packages/agent    Runtime, planning, handoff, checkpoints, recovery, history, tasks
        │
        ▼
  packages/models   Model providers (Gemini, OpenAI, OpenAI-compatible, Ollama), tool executor, permissions
        │
        ▼
  packages/shared   Common types, ID utilities, configuration loaders
  ```
- ~66,000 lines of TypeScript across the monorepo.

---

## 2. Core Architecture

| Component | Role |
|---|---|
| `AgentRuntime` | Main runtime coordinator: run state machine, tool registries, permission manager, skill loader, orchestrates planning/execution. |
| `ProductRuntime` | Reactive bridge between `AgentRuntime` and the Ink UI; turns raw `AgentEvent` streams into structured `UIState` snapshots. |
| `PlanExecutor` | Executes a `TaskPlan` step-by-step in dependency order; evaluates prerequisites, staleness, feedback, retries. |
| `ExecutionHandoffManager` | **The authoritative security/execution boundary.** Revalidates risk, validates single-use checkpoints, confirms approvals, checks permissions, performs the actual protected tool execution. |
| `DefaultCheckpointManager` | Lifecycle of rollback checkpoints: captures repo status, tracks approval requests, ensures atomic single-use consumption. |
| `DefaultResumeManager` | Resumes interrupted/failed runs: verifies project identity, captures workspace diffs, reassesses risk, issues a clean new run identity. |
| `DefaultRecoveryManager` / `RecoveryContinuationManager` | Post-failure checkpoint recovery, post-repair verification, workspace reconciliation, gated continuation. |

**Single Authoritative Execution Path** (every mutation, no exceptions per design):
```
CLI UI → ProductRuntime → AgentRuntime → PlanExecutor → ExecutionHandoffManager
       → TaskRiskPolicy (non-downgrade risk assessment) → detectPlanStaleness
       → CheckpointManager (create + request single-use approval)
       → InteractiveApprovalResolver (explicit user authorization)
       → PermissionManager (tool permission validation)
       → CheckpointManager.consume() (atomic single-use)
       → ToolExecutor.execute()
```

---

## 3. Safety Model

**Risk levels** (deterministic, assigned to every task/step/mutation):

| Level | Examples | Checkpoint? | Explicit Approval? |
|---|---|---|---|
| `low` | `read_file`, `search_files`, `list_directory` | No | No |
| `normal` | Single-function/file edits | No | Yes (per tool policy) |
| `elevated` | Multi-file edits (4+), config changes (`package.json`, build scripts) | Yes | Yes |
| `critical` | `delete_file`, drops, broad rewrites, recovery actions | Yes | Yes |

- **Non-downgrade invariant**: runtime risk reassessment can only escalate, never de-escalate, a plan's risk.
- **Destructive ops** (`delete_file`/`remove`/`wipe`/`purge`/`drop`/`destroy`) always require approval and are **never** auto-retried.
- **Approval-type isolation**: Plan approval, step/checkpoint approval, tool-permission approval, recovery approval, continuation approval, and replan approval are all distinct — none grants another.
- **Safe defaults everywhere**: empty input, invalid input, or Ctrl+C on any approval prompt resolves to Deny/Cancel.
- **No inheritance across boundaries**: resumed runs get no inherited approvals/checkpoints; checkpoints are rejected cross-plan and cross-run; checkpoint approvals TTL out after 5 minutes unconsumed; branch switches or file drift invalidate pending approvals.
- **Secret sanitization**: API keys/tokens/private keys are redacted (`[REDACTED_API_KEY]` etc.) before any telemetry/history persistence.

**Planning & recovery lifecycle**: `TaskPlan` states `draft → ready → approved → executing → (blocked ↔ executing | superseded | cancelled/failed) → completed`. Steps are typed (`inspect/analyze/modify/configure/test/verify`), carry dependencies, and failed prerequisites cascade dependents to `skipped`. `detectPlanStaleness` re-checks target-file existence, branch changes, and external modification before every step. Replanning is user-gated and depth-bounded (max 5), with lineage tracked via `parentPlanId`/`rootPlanId`/`replanDepth`. Recovery after a block requires explicit authorization, post-repair verification, and workspace reconciliation before any continuation is even offered.

---

## 4. Providers & Configuration

Supported providers: **Gemini** (default, `gemini-2.5-flash`), **OpenAI**, **Ollama** (local), and a generic **openai-compatible** provider (NVIDIA NIM, vLLM, DeepSeek, Together AI, self-hosted proxies), configured via `FE_PROVIDER`/`FE_MODEL` plus per-provider API key/base-URL env vars. An **auto-fallback** mechanism (opt-in via `FE_AUTO_FALLBACK=true`) can switch providers on quota exhaustion/rate limits, bounded by `FE_MAX_RETRIES_PER_PROVIDER` (default 1) and `FE_MAX_FALLBACK_SWITCHES` (default 2), with documented mid-stream safety guarantees (clean restart before output, discard-and-restart mid-text, drop incomplete tool-call fragments, and a hard block on fallback once a tool call has actually dispatched).

---

## 5. CLI Surface

Ink/React TUI with a persistent header (project/provider/branch/status badge), workspace & security panel (risk level, checkpoint/approval requirements, drift indicators), plan/progress panel (step icons + progress bar), timeline stream, and modal prompts for approval/blocked/recovery/replan/resume flows. Responsive across 4 terminal-width tiers. ~20 slash commands: `/help /status /plan /runs /run /resume /replan /debug /diagnostics /history /tasks /task /git /checkpoints /checkpoint /recover /sessions /delete-session /clear /exit`.

---

## 6. Build History

**Phase 1 (Aug 10–11, 2026) — Foundations.** Monorepo scaffold, `ModelProvider` abstraction (streaming OpenAI first), `AgentRuntime` conversation/event core, Ink CLI shell with streaming + Ctrl+C cancel.

**Phase 2 (Aug 11–12) — Tools & multi-model.** Provider-agnostic tool-call protocol; `list_directory`/`read_file`/`search_files` (path-traversal-safe); autonomous multi-step tool loop proven end-to-end; Gemini + Ollama providers added.

**Phase 3 (Aug 12) — Mutation, execution, safety.** The largest phase: decoupled permission/approval architecture → interactive terminal approval UI → `write_file` → `edit_file` (exact-match validation, diffs, conflict detection) → `.env` config loading → locked-down `execute_command` (no shell, tokenized validation, timeouts, env scrubbing) → bounded edit→verify→fix self-correction loop (max 3 attempts).

**Phase 4 (Aug 12–13) — Frontend intelligence & skills.** Deterministic, LLM-free `ProjectDetector` (framework/build-tool/package-manager/styling/testing detection); skill system with 10 built-in frontend skills, twice-iterated into the `SKILL.md` format (YAML frontmatter + structured sections, path-traversal-protected loader).

**Phase 5 (Aug 26) — Execution hardening & product shell.** `DefaultExecutionHandoffManager` consolidated into the single 12-step authoritative boundary across every path (normal/resume/retry/recovery/replan); `ProductRuntime` facade + pure `UIState` reducer so the UI layer is read-only and cannot bypass execution safety.

**Post-v1 standalone fix/feature timeline:**

| Date | Change |
|---|---|
| Sep 28 | StatusBar responsive-overflow fix (width breakpoints, stop ANSI ghost-text) |
| Sep 29 | `/runs` scoped to active project by default (+`--all`); test runs sandboxed off real `~/.fecode/history` |
| Sep 30 | Cross-platform `killProcessTree` (Windows `taskkill /T /F`, POSIX process-group kill) |
| Oct 2 | Terminal scroll-lock fix: windowed turn rendering + PageUp/PageDown/Home/End, slower spinner |
| Oct 2 | Thinking-UI stabilized (buffered reasoning stream); approval prompt upgraded to arrow-key/Tab menu |
| Oct 4 | `React.memo` on `TurnView`/`MessageBubble`/`ThinkingBlock` + 50ms (20fps) stream-render throttling |
| Oct 7 | Background daemon tasks: `TaskManager` + `manage_task` tool, `isDaemon:true` on `execute_command`, bypassing the 30s timeout |
| Oct 8–9 | Indirect prompt-injection defense: XML boundary fencing (`<untrusted_content>`, `<untrusted_code_snippet>`) + tag neutralization + system-prompt Rule 11 |
| Oct 10 | Pre-rename hash verification in `edit_file`: re-hash full file immediately before atomic write, abort with `EDIT_CONFLICT` on external modification |

**Trajectory**: textbook layered build order (runtime → tools → safety/approval → product intelligence → execution-integrity consolidation), each phase gated behind full build/lint/test. The last two weeks of standalone fixes pivot from UI/performance polish (4 of 9 items) to security/correctness hardening (prompt injection defense, hash-verified edit conflicts), both explicitly tied to a formal audit cycle that appears to still be actively driving the roadmap.

---

## 7. Audit History (5 reports in `docs/audit/`)

| Report | Scope | Finding count | Stated verdict |
|---|---|---|---|
| `AUDIT_REPORT.md` / `FeCode_Comparative_Terminal_Agent_Bug_Audit_Report.md` *(identical files)* | Comparative vs. Claude Code / Google Antigravity / OpenCode-Codex, by "Antigravity AI" | 14 core bugs + 17 adversarial failure modes + 27 filesystem/OS edge cases | 14 core bugs "all resolved, zero regressions"; most of the 17 + 27 extended items left as open roadmap (only security-critical ones — symlink traversal, injection, env leaks — actually remediated) |
| `FeCode_Comprehensive_Bug_Hunt_Audit_Report.md` | From-scratch, multi-subagent line-by-line audit across planning/recovery, checkpoints/history/git, security/tools/policies, runtime/providers/context, CLI/UI | 86 bugs (9 critical / 29 high / 37 medium / 11 low) | Analysis only, all presented as newly discovered/unresolved at time of writing, phased remediation roadmap proposed |
| `FeCode_v1.0.0_Final_Bug_Audit_Report.md` | Post-GA regression/verification gate | 18 prior bugs reverified fixed + 8 new v1.0.0-feature edge cases + 3 structural limitations | All reverified items + 11 new ones marked Resolved; framed as mature, continuously-hardening release (lint 0 errors, 988 tests passing) |
| `FeCode_v1.0.0_UI_UX_Bug_Audit_Report.md` | Ink/React UI layer only (modals, shortcuts, command palette) | 13 bugs (3 high / 4 medium / 6 low) | Presented as open findings with a 3-phase fix roadmap, not verified fixed within the document itself |

**Consolidated themes across all five** (dedupe status approximate — see full reports for exact line references):
- **Process/command execution & sandboxing** — Windows orphaned subprocesses, shell newline-injection bypass, env-secret leakage to children, symlink/junction sandbox escape, TOCTOU races on edit/approval: largely **fixed**; the 27-item filesystem-edge-case catalog (FIFOs, NTFS ADS, device files, hard links, sparse files) is still mostly **open/roadmap**.
- **Terminal rendering/UI** — status-bar overflow, unbounded turn re-render flicker, unbounded `/runs`/`/sessions` dumps: **fixed**. Contradictory keyboard-shortcut labels across modals, Ctrl+C hard-exiting instead of dismissing a modal, non-functional Esc-to-cancel, phantom hotkeys typed into the prompt, `RunHistoryView` only ever receiving one item: still **open** per the UI/UX-specific audit.
- **Provider/context/runtime** — hardcoded truncation blindspot, lossy context-compaction stub, Gemini role-alternation break, hardcoded wrong default provider, Ollama NaN context size: **fixed**. Stream-error handling permanently hanging the CLI in "executing": **unclear/unverified**.
- **Planning/recovery/checkpoints** — non-git recovery silently no-op'ing, dual checkpoint-ID generation breaking `/recover`, intent-text written into source files during repair: **fixed**. In-memory-only checkpoint records lost on restart: acknowledged **open structural limitation**.
- **Approval/security boundary** — approval bypass when checkpoints disabled, checkpoint consumed before approval resolved, approval-resolver hang: **fixed**.

**Net read**: a fast-moving, genuinely security-conscious project that reliably fixes what gets flagged, but keeps generating fresh audit surface area with each pass — maturity trending up, not yet "done." The comparative report's own "all solved" headline is contradicted by its later sections, where most of the extended failure-mode/filesystem catalog remains unaddressed.

---

## 8. Independent Review Findings (this session, against the cloned source)

A direct security + code-quality review of the actual source at `/home/garv/FeCode` (not from the docs) found the core safety mechanics hold up — the approval gate (`runtime.ts`, `models/src/permissions/policy.ts`) and path/symlink confinement (`tools/pathUtils.ts`) could not be bypassed under adversarial reading — but surfaced issues not reflected as resolved in the docs above:

- **[HIGH] Windows shell-injection bypass** (`agent/src/commands/policy.ts`, `nodeExecutor.ts`) — the forbidden-char scanner treats `'` the same as `"` as a safe quoting region, but batch executables (npm/npx/pnpm/yarn/bun) on Windows run via `spawn(cmd, [], {shell:true})` against cmd.exe, which doesn't honor `'` as a quote char at all — so a quoted-looking command can still inject `&`/`|` on Windows.
- **[HIGH] Untrusted-content fence bypass** (`agent/src/context/toolResultSanitizer.ts`) — `fenceUntrustedContent` skips its own `neutralizeFenceTags` pass entirely when content already starts/ends with the `<untrusted_content>` markers, letting crafted content defeat the prompt-injection boundary described as "Approved" in the Oct 8 design spec (§2 above).
- **[MEDIUM]** Daemon-task cleanup (Oct 7 feature) only runs on Node's `"exit"` event, so a SIGKILL/crash leaves spawned dev-server/watcher processes running untracked.
- **[HIGH]** `FallbackModelProvider` never calls its own `resetActiveProvider()` — once a transient rate limit demotes the session to a fallback provider, it never reverts, contradicting the "bounded, deterministic" fallback behavior documented in §4 above.
- **[HIGH]** `planner.ts`'s mutation-intent detector is a 14-substring keyword list — a request like "Add input validation to the login handler" matches none of them and silently gets planned as read-only-only, i.e. the agent never makes the requested change.
- **[HIGH]** `taskPlan.ts`'s `failPlanStep` marks a step `"failed"` (and cascades the whole plan to `"failed"`) even when the emitted event says `plan_step_skipped`, corrupting persisted run-history state.
- **[MEDIUM]** `errors/classification.ts` marks `transient_network` errors fallback-ineligible with only 1 retry by default, so a real provider outage exhausts the chain even with healthy fallbacks configured — the opposite of what §4's fallback section promises.

These read as the kind of items a *next* audit pass (Comprehensive-Bug-Hunt-style) would catch — several directly undercut specific "Approved"/fixed claims in the specs and v1 docs above.

---

## 9. Post-V1 Backlog (feature-frozen for 1.0.0 GA)

| # | Item | Target |
|---|---|---|
| 1 | Multi-provider failover & dynamic routing | V1.1 |
| 2 | Cloud/remote execution sandboxes | V2.0 |
| 3 | Desktop/web GUI | Post-V2 (explicitly against the CLI-only architectural invariant) |
| 4 | Third-party plugin marketplace | V1.2 |
| 5 | Autonomous background execution loops (no approval) | Deferred indefinitely — violates the core human-in-the-loop invariant |
| 6 | Concurrent multi-agent swarm orchestration | V2.0 |
| 7 | Multi-user collaborative sessions | V2.0 |
| 8 | Standalone binary packaging (pkg/nexe, Homebrew) | Phase 5AH (V1.0 GA) |

V1.1 triage priority: multi-provider failover + enhanced skill authoring.

---

## 10. Source Documents

Extracted from `docs.zip`:
- `docs/v1/*.md` — 16 user/architecture docs (architecture, security-model, risk-levels, approvals-permissions, planning, recovery, replanning, checkpoints, resume, diagnostics, configuration, cli-usage, installation, getting-started, troubleshooting, post-v1-backlog, v1-acceptance-checklist).
- `docs/superpowers/specs/*.md` — 4 approved design specs (turn memoization/stream throttling, background daemon tasks, indirect prompt-injection defense, pre-rename hash verification).
- `docs/superpowers/plans/*.md` — 35 dated implementation plans, Aug 10 – Oct 10, 2026, phases 1–5 plus 9 standalone post-v1 plans.
- `docs/audit/*.md` — 5 bug-audit reports (one a duplicate), Comprehensive Bug Hunt (86 findings), Comparative vs. other agents, UI/UX-specific, and v1.0.0 Final Gate.
