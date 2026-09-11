# Changelog

All notable changes to FeCode are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-11

### Initial General Availability Release

FeCode V1.0.0 is the first production release of the terminal-native, safety-first AI coding assistant. FeCode transforms natural language developer requests into explicit, inspectable task plans executed through strict safety and approval boundaries.

### Core Capabilities

#### 1. Interactive Terminal UI (TUI)
- Persistent terminal interface built with **Ink** and **React**.
- Responsive layout adapting dynamically across wide (≥100 cols), medium (70–99 cols), and compact terminal dimensions.
- Header with real-time Git branch, working directory, and live status badges (`PLANNING`, `EXECUTING`, `VERIFYING`, `APPROVAL REQUIRED`, `BLOCKED`, `COMPLETED`, `FAILED`, `CANCELLED`).
- Deterministic unicode progress bar tracking step-level completion.
- Interactive modals for approvals, blocked states, guided recovery, replanning, and historical run resumption.
- Context-sensitive keyboard shortcuts (`Tab`, `↑`/`↓`, `Ctrl+C`, `Esc`, `y`/`n`).

#### 2. Planning & Execution Lifecycle
- Multi-step task planner decomposing developer requests into structured, typed plan steps (`inspect`, `create`, `modify`, `command`, `test`, `verify`).
- Formal state machine governing transitions: `planned` → `ready` → `waiting_approval` → `executing` → `verifying` → `completed` (or `blocked` / `failed` / `cancelled`).
- Read-only preliminary repository exploration to inform plan generation before requesting state changes.

#### 3. Deterministic Risk Engine & Protected Boundary
- Automated risk classification engine categorizing operations into `NORMAL`, `ELEVATED`, or `CRITICAL`.
- Authoritative `ExecutionHandoffManager` as the sole gateway for protected operations; tools have no direct execution path to host OS.
- Mandatory interactive approval gates for elevated actions (file modifications, deletions, and shell command executions).
- Non-transferable, single-use approvals preventing authorization bleed across steps or tasks.

#### 4. Checkpoints, Rollback & Reconciliation
- Automatic pre-execution workspace state snapshots via Git repository integration.
- Single-use checkpoint consumption preventing stale rollback attempts.
- Guided recovery pipeline assessing failure causes and offering explicit remediation (`recheck`, `replan`, `continue`).
- Pre/post execution change attribution isolating FeCode edits from pre-existing uncommitted user changes.

#### 5. Durable History, Resumption & Replanning
- Serialized run records persisting task plans, tool invocations, token consumption, and exit summaries to disk.
- Complete credential and token sanitization prior to disk persistence.
- Safe resume capability: Resumed tasks receive a fresh run ID, preserve lineage, and require fresh authorization.
- Explicit replanning mechanism adapting invalid or stale plans without unprompted auto-execution.

#### 6. Multi-Provider LLM Integration
- Unified streaming abstraction supporting:
  - **Google Gemini**: `gemini-2.5-flash`, `gemini-1.5-pro`
  - **OpenAI**: `gpt-4o`, `gpt-4o-mini`
  - **Ollama**: Local, completely offline execution with `qwen2.5-coder` and compatible models.
- Layered configuration hierarchy: CLI arguments > Environment variables > `.env` > Built-in defaults.

#### 7. Packaging & Distribution
- Monorepo structure with clean package separation: `@fecode/cli`, `@fecode/agent`, `@fecode/models`, `@fecode/shared`.
- Dual binary entry points: `fe` and `fecode`.
- Node.js runtime compatibility: `>= 20.0.0` (v20, v22, v24).
- Production distribution tarballs certified zero-leak (no secrets, test files, or source maps).

### Deferred Scope (Post-V1 Backlog)
The following capabilities are intentionally deferred beyond V1.0.0 to ensure core execution safety:
- Multi-provider dynamic runtime failover (Target: V1.1)
- Third-party skill/plugin marketplace (Target: V1.2)
- Cloud sandbox remote execution (Target: V2.0)
- Concurrent multi-agent worktree swarms (Target: V2.0)
- Desktop / GUI applications (Electron/Tauri) — Deferred indefinitely in favor of 100% terminal focus.
- Autonomous background execution loops — Deferred indefinitely in adherence to human-in-the-loop safety principles.
