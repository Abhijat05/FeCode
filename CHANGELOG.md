# Changelog

All notable changes to FeCode are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-10-10

### Fixed & Security Hardening
- **Path Traversal & Symlink Safety**:
  - Resolved symlink and NTFS junction directory traversal vulnerabilities in `pathUtils` by enforcing strict canonical path boundary checks.
  - Added checks to reject FIFOs, device files, and non-regular special files before opening.
- **Process Isolation & Command Injection Defense**:
  - Prevented shell newline command injection in command policy validation.
  - Scrubbed and isolated sensitive environment variables from being leaked into child processes.
  - Sanitized command output against hostile ANSI/OSC escape sequences with safe grapheme-aware Unicode slicing.
- **Atomic File Writing & Concurrency Safety**:
  - Hardened `atomicWriter` to handle `EXDEV` cross-device moves, Windows long paths (`\\?\`), and avoid file truncation/zeroing on `ENOSPC`.
  - Enforced pre-rename content SHA-256 hash verification in `editFile` to prevent silent overwrite races.
  - Hardened `readFile` with non-blocking opens and graceful stream error handling.
- **Context Budgeting & Injection Defense**:
  - Added prompt injection defense meta-rules to the default agent system prompt.
  - Added XML boundary fencing and tag neutralization for untrusted tool outputs and repository code snippets.
  - Prevented JSON corruption and malformed payloads during tool result truncation.
  - Fixed CRLF normalization, gitignore search handling, dynamic context budgeting, and prompt history indexing.
- **Provider Timeouts & Stream Watchdog**:
  - Added configurable request timeout (`FE_REQUEST_TIMEOUT_MS` / `OPENAI_TIMEOUT_MS`, default 60s) to `OpenAIModelProvider` and `OpenAICompatibleModelProvider` to prevent indefinite hangs on stalled endpoints.
  - Added stream chunk idle watchdog (`FE_STREAM_IDLE_TIMEOUT_MS`, default 45s) to safely detect and abort frozen SSE connections.
  - Classified connection timeouts and stream stalls as retryable `transient_network` errors without confusing them with user cancellation.
- **Dependency Audit**:
  - Updated `source-map-js` to 1.2.2 to resolve npm audit vulnerability.

### Added & Improved
- **Background Task Management**:
  - Implemented `TaskManager` and registered `manage_task` tool to support daemon background processes (`isDaemon`).
  - Added robust teardown preventing stream `ENOENT` crashes during task termination.
- **Context Compaction & Turn Summarization**:
  - Implemented structured turn summarization and compaction digests to maintain coherence in long-running agent loops.
- **CLI & TUI UX Improvements**:
  - Stabilized terminal viewport rendering during LLM thinking blocks and reasoning token streams.
  - Enabled arrow-key history scrolling and interactive approval selection via arrow keys and Enter.
  - Added pagination for `/sessions` and secondary views with viewport height clamping to eliminate keystroke jitter.
  - Optimized terminal rendering performance with turn memoization and stream batching.

---

## [1.1.0] - 2026-10-01

### Added
- **Generic OpenAI-Compatible Provider (`openai-compatible`)**:
  - Implemented `OpenAICompatibleModelProvider` conforming to the unified `ModelProvider` interface, allowing connections to any service providing the OpenAI chat completions specification (NVIDIA NIM, DeepSeek API, vLLM, Together AI, local gateways) without vendor-specific code modifications.
  - Strict separation of transport protocol (`FE_PROVIDER=openai-compatible`) from model identity (`FE_MODEL`).
- **Custom OpenAI-Compatible Endpoint Configuration**:
  - Added support for `OPENAI_BASE_URL` and `FE_OPENAI_BASE_URL` to configure custom service endpoints.
  - Added optional dedicated `OPENAI_COMPATIBLE_API_KEY` / `FE_OPENAI_COMPATIBLE_API_KEY` to prevent credential collision when both standard OpenAI and OpenAI-compatible endpoints are configured.
- **NVIDIA API Compatibility & DeepSeek Acceptance**:
  - Validated compatibility with NVIDIA NIM endpoints (`https://integrate.api.nvidia.com/v1`) and NVIDIA-hosted DeepSeek models (`deepseek-ai/deepseek-v4.1-flash`).
- **Streaming & Reasoning Token Extraction**:
  - Live token streaming with non-buffered async iterable event dispatch.
  - Automatic extraction and display of reasoning tokens (`reasoning_content` / `reasoning`) wrapped in `<think>` tags within the terminal TUI's collapsible thinking block.
  - Structured function and tool calling with multi-chunk argument accumulation.
- **Provider Fallback Integration**:
  - Full participation of `openai-compatible` as either primary provider or fallback candidate in `FE_FALLBACK_PROVIDERS`.

### Safety / Reliability
- **Mid-Stream Fallback Protection**:
  - Safe discard of uncommitted output fragments when quota exhaustion occurs mid-stream.
  - Interruption notices rendered in TUI, restarting generation on replacement providers with clean conversation history.
- **Incomplete Tool-Call Suppression**:
  - Incomplete or fragmented tool calls from failed or aborted attempts are dropped and never dispatched or executed.
- **Post-Dispatch Fallback Blocking**:
  - Preserved the atomic turn execution boundary, blocking automatic fallback if tools were already dispatched within the turn.
- **Cancellation-Safe Provider Attempts**:
  - `AbortSignal` cancellation immediately aborts active streams, terminates candidate attempts, and prevents unintended fallback switches.
- **Credential Redaction & Isolation**:
  - Extended error and reason sanitization to detect and redact NVIDIA `nvapi-...` credentials.
  - Dynamic redaction of active configured credentials from thrown errors and diagnostics.
- **Provider Error Classification**:
  - Structured categorization of HTTP 401 (authentication), HTTP 404 (unsupported model), HTTP 429 (quota exhaustion/rate limit), and transient network errors.

### Documentation
- Documented `openai-compatible` configuration, environment variables, and NVIDIA DeepSeek integration examples in `docs/v1/configuration.md` and `README.md`.
- Added clear guidance on endpoint URL resolution and secret management.

---

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
