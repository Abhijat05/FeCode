# Changelog

All notable changes to FeCode are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-09-26

### Added
- **Deterministic Opt-In Provider Auto-Fallback**:
  - Configurable multi-provider fallback chains across Gemini, OpenAI, and Ollama when qualifying quota exhaustion or rate limit conditions occur (`FE_AUTO_FALLBACK=true`).
  - Structured provider error classification (`classifyProviderError`) distinguishing fallback-eligible quota/rate-limit conditions, retryable transient failures, terminal authentication errors, and context length limits.
  - Bounded retry policy for transient errors before switching to replacement providers.
  - Strict preservation of provider-specific credentials (`GEMINI_API_KEY`, `OPENAI_API_KEY`, Ollama host) without credential cross-contamination.
- **Mid-Stream Safety & Streaming Guarantees**:
  - Interrupted partial text deltas are safely discarded upon mid-stream quota exhaustion, guaranteeing conversation history contains only final, clean generation.
  - Incomplete tool-call fragments generated prior to mid-stream failure are cleanly discarded and never dispatched or persisted.
  - Deterministic same-turn execution boundary: blocks automatic fallback if tools were already dispatched within the current turn, preventing replay of side effects and duplicate operations.
  - Cancellation safeguards: immediate termination of fallback chains upon signal abort, rejecting late events from superseded attempts.
- **Diagnostics, Telemetry & TUI Notices**:
  - Structured tracking of fallback decisions, provider attempt states (`streaming`, `completed`, `exhausted`, `superseded`, `cancelled`, `failed`), token discards, and uninterrupted durable run session resumption.
  - Non-intrusive Ink/React TUI fallback notices and interruption indicators.
  - Comprehensive secret redaction ensuring API keys, bearer tokens, and credentials are never leaked in error messages, fallback reasons, or persistent run history.

### Fixed
- **Package Manifest Metadata**:
  - Added explicit `"license": "MIT"` metadata in `apps/cli/package.json` aligning published npm package metadata with repository license.

---

## [1.0.2] - 2026-09-21

### Fixed
- **Terminal UI Rendering & Layout Stability**:
  - Repositioned Command Palette suggestions below the input prompt line (`› `) in `TaskInput`, eliminating vertical cursor jumping while typing slash commands.
  - Added responsive viewport-aware height capping to `CommandPalette` to prevent ANSI erase clamping and scrollback duplication in 24-row terminals.
  - Automatically dismiss command suggestions upon typing a trailing space or accepting a Tab autocomplete suggestion.
  - Emitted ANSI terminal clear sequence `\x1b[2J\x1b[H` on interactive startup, guaranteeing maximum vertical headroom.
- **Git Workspace View Activation**:
  - Fixed `/git` slash command to directly open the Git workspace view.
  - Reset approval prompt inputs and modal input buffers upon rejection or cancellation.
- **Header Telemetry**:
  - Wired real-time elapsed timer duration during live task execution.
  - Displayed persistent Session ID in Header while idle.
- **Status Bar Integration**:
  - Wired active plan step progress and current step title to the live status bar during plan execution.
- **Secondary Views & Durable Runs Isolation**:
  - Isolated secondary views (`/plan`, `/runs`, `/debug`, `/help`, `/git`) to prevent rendering conversation turns underneath.
  - Wired full durable historical runs list into `RunHistoryView`.
  - Added top scroll indicator (`▲ …N more`) to `CommandPalette` when navigated past visible bounds.

---

## [1.0.1] - 2026-09-17

### Fixed
- Included `README.md` and packaged assets in published npm package distribution.
- Resolved package naming and dependency references in `package-lock.json`.

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
