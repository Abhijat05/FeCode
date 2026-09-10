<p align="center">
  <img src="assets/fecode-banner.jpg" alt="FeCode" width="100%" style="border-radius: 8px;" />
</p>

<p align="center">
  <strong>A safety-first, plan-driven terminal coding assistant for developers.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fecode/cli"><img src="https://img.shields.io/badge/npm-@fecode/cli-red.svg" alt="npm package" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E=20.0.0-brightgreen.svg" alt="Node.js version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/typescript-strict%205.7+-blue.svg" alt="TypeScript Strict" />
  <img src="https://img.shields.io/badge/tests-976%20passed-success.svg" alt="Tests" />
  <img src="https://img.shields.io/badge/version-1.0.0--rc.1-orange.svg" alt="Release Candidate" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Why FeCode](#why-fecode)
- [Key Features](#key-features)
- [Execution Safety Model](#execution-safety-model)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Supported Providers](#supported-providers)
- [CLI & Slash Commands](#cli--slash-commands)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Git Awareness & Workspace Tracking](#git-awareness--workspace-tracking)
- [Diagnostics & Durable History](#diagnostics--durable-history)
- [Monorepo & Development](#monorepo--development)
- [Contributing](#contributing)
- [Security Policy](#security-policy)
- [License](#license)

---

## Overview

**FeCode** is an interactive, terminal-native AI coding assistant built for developers who want the velocity of LLM-assisted programming without surrendering control of their workspace.

Unlike traditional AI assistants that execute commands or alter code in uncontrolled loops, FeCode enforces an explicit engineering lifecycle:

$$\text{Prompt} \longrightarrow \text{Plan} \longrightarrow \text{Risk Assessment} \longrightarrow \text{Approval Gate} \longrightarrow \text{Execution Handoff} \longrightarrow \text{Verification}$$

FeCode runs 100% in your terminal through an interactive [Ink](https://github.com/vadimdemedes/ink)/React interface. It inspects local projects, generates structured task plans, classifies risks, acquires explicit human consent for state modifications, and verifies that code compiles and tests pass before declaring a task complete.

---

## Why FeCode

Traditional terminal coding assistants operate on a direct execution model:

```text
Traditional Assistant:
User prompt ──▶ Model emits shell command / file edit ──▶ Blind execution ──▶ Unintended workspace corruption
```

FeCode treats code mutation as a protected operational boundary:

```text
FeCode Safety Pipeline:
User prompt
     │
     ▼
Repository Inspection & Context Detection
     │
     ▼
Structured Task Plan (Inspectable, Step-by-Step)
     │
     ▼
Deterministic Risk Classification (NORMAL · ELEVATED · CRITICAL)
     │
     ▼
Interactive Human Approval Gate (Single-use, Non-transferable)
     │
     ▼
Rollback Checkpoint Creation (Git snapshot / File backup)
     │
     ▼
ExecutionHandoffManager (Authoritative Protected Boundary)
     │
     ▼
Verification Loop (Unit tests, typechecks, drift detection)
     │
     ▼
Deterministic Completion Summary
```

### Core Tenets

- **Plan First**: Every complex request is decomposed into an ordered, inspectable plan before execution begins.
- **Explicit Authorization**: No file modification, file deletion, or terminal command executes without explicit approval.
- **Single-Use Consents**: Permissions cannot be silently inherited or reused across steps, tasks, or resumed sessions.
- **No Destructive Retries**: Destructive operations are never blindly re-executed on failure.
- **Durable History**: Runs are persisted to disk with sanitized credentials, enabling post-mortem diagnostics and deterministic resumption.

---

## Key Features

| Capability | Description |
| :--- | :--- |
| **Inspectable Planning** | Translates ambiguous developer requests into explicit, ordered plan steps. |
| **Deterministic Risk Engine** | Classifies every action into `NORMAL`, `ELEVATED`, or `CRITICAL` risk tiers based on files and tools touched. |
| **Authoritative Handoff** | All protected tool executions route exclusively through the `ExecutionHandoffManager` boundary. |
| **Single-Use Checkpoints** | Captures pre-execution Git state snapshots to allow safe inspection and deterministic rollback. |
| **Verification Loops** | Validates code modifications with compiler checks and test commands before claiming completion. |
| **Bounded Recovery** | Detects execution failures and offers guided remediation without unbounded autonomous looping. |
| **Fresh-Auth Resume** | Resumes interrupted or failed tasks under a new lineage with strictly re-prompted authorization. |
| **Git Drift Tracking** | Compares baseline workspace state against modified files to detect external edits and prevent data loss. |
| **Interactive TUI** | Built with Ink and React, providing a responsive terminal UI with progress bars, modals, and split views. |
| **Multi-Provider Support** | First-class support for Google Gemini, OpenAI, and local Ollama models. |

---

## Execution Safety Model

FeCode’s safety guarantees are formal system invariants verified by continuous automated test suites:

1. **Authoritative Execution Boundary**: Tools cannot bypass the `ExecutionHandoffManager`. There is no direct execution route from the LLM prompt to the host operating system.
2. **Deterministic Risk Invariance**: Action risk is calculated prior to execution and cannot be downgraded by prompt injection or model suggestion.
3. **Approval Isolation**: Approvals granted for step $N$ expire immediately upon completion and cannot satisfy step $N+1$.
4. **Resumed Run Isolation**: A resumed session receives a brand-new run ID. Approvals from the original run are void.
5. **Bounded Retry Limit**: Flaky or failing commands are limited by bounded retry policies; FeCode never enters an infinite loop.
6. **Credential Sanitization**: Persisted run history, telemetry dumps, and error logs automatically strip API keys and authorization tokens.

---

## Installation

FeCode requires **Node.js `>= 20.0.0`** and **npm `>= 10.0.0`**.

### Global Package Installation (Recommended)

```bash
# Install globally via npm
npm install -g @fecode/cli

# Verify installation
fe --version
fecode --version
```

### Install From Source

```bash
# Clone the repository
git clone https://github.com/Abhijat05/FeCode.git
cd FeCode

# Install dependencies and compile all packages
npm install
npm run build

# Link CLI locally
npm link --workspace=apps/cli
```

*For detailed platform instructions and environment requirements, see the [Installation Guide](docs/v1/installation.md).*

---

## Quick Start

### 1. Configure Provider Credentials

Set your provider and credentials using environment variables or a `.env` file in your workspace:

```bash
# Option 1: Google Gemini (Recommended Default)
export FE_PROVIDER="gemini"
export FE_MODEL="gemini-2.5-flash"
export GEMINI_API_KEY="your-gemini-api-key"

# Option 2: OpenAI
export FE_PROVIDER="openai"
export FE_MODEL="gpt-4o"
export OPENAI_API_KEY="your-openai-api-key"

# Option 3: Local Ollama (Completely Offline)
export FE_PROVIDER="ollama"
export FE_MODEL="qwen2.5-coder"
export OLLAMA_BASE_URL="http://localhost:11434/v1"
```

### 2. Launch FeCode

Navigate to any project repository and run `fe`:

```bash
cd /path/to/your/project
fe
```

### 3. Issue Your First Task

```text
> Inspect this project, explain its architecture, and run the test suite.
```

FeCode will:
1. Detect project framework and package structure (`Node.js`, `TypeScript`, `Git`).
2. Generate an explicit 3-step task plan.
3. Display the plan in the terminal and request approval for any command execution.
4. Execute inspected steps and stream formatted output.
5. Provide a verified completion summary with Git change attribution.

*Read the complete [Getting Started Guide](docs/v1/getting-started.md) for deeper workflow examples.*

---

## Configuration

FeCode supports layered configuration with deterministic precedence:

```text
CLI Flags  ──▶  Environment Variables  ──▶  Workspace .env  ──▶  Built-in Defaults
(Highest)                                                               (Lowest)
```

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `FE_PROVIDER` | LLM provider backend (`gemini`, `openai`, `ollama`) | `gemini` |
| `FE_MODEL` | Model name override | `gemini-2.5-flash` / `gpt-4o` / `qwen2.5-coder` |
| `GEMINI_API_KEY` | API key for Google Gemini provider | None (Required for Gemini) |
| `OPENAI_API_KEY` | API key for OpenAI provider | None (Required for OpenAI) |
| `OLLAMA_BASE_URL` | Base API endpoint for local Ollama daemon | `http://localhost:11434/v1` |

*Refer to [Configuration Documentation](docs/v1/configuration.md) for full configuration specs.*

---

## Supported Providers

FeCode abstracts model providers behind a unified streaming interface in `@fecode/models`:

| Provider | Recommended Models | Streaming | Function Calling | Local / Offline |
| :--- | :--- | :---: | :---: | :---: |
| **Google Gemini** | `gemini-2.5-flash`, `gemini-1.5-pro` | Yes | Yes | Cloud |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini` | Yes | Yes | Cloud |
| **Ollama** | `qwen2.5-coder`, `deepseek-coder` | Yes | Yes | **Local (100% Offline)** |

---

## CLI & Slash Commands

### Command Line Flags

```bash
fe [options]
fecode [options]

Options:
  -v, --version       Display FeCode version
  -h, --help          Display help and command overview
  -r, --resume <id>   Resume an interrupted session or historical run by ID
```

### Interactive In-Terminal Slash Commands

Inside the active FeCode terminal session, type `/` to access built-in commands with autocomplete:

| Slash Command | Description |
| :--- | :--- |
| `/help` | Display list of commands and keyboard shortcuts |
| `/status` | View active session, selected model, and project context |
| `/plan [runId]` | Display active task plan or inspect the plan of a previous run |
| `/replan` | Request plan adaptation or re-evaluation for current task |
| `/resume <id>` | Prepare and resume execution from a historical run |
| `/runs [limit]` | List recent durable runs recorded for this workspace |
| `/run <id>` | Inspect detailed execution record of a specific run |
| `/debug` | Display real-time diagnostics summary for current run |
| `/diagnostics` | Display complete telemetry and diagnostic trace |
| `/history` | View completed tasks and outputs in the current session |
| `/git` | Inspect Git repository status, active branch, and modified files |
| `/checkpoints` | List available rollback checkpoints |
| `/checkpoint` | Create a new manual workspace checkpoint |
| `/recover` | Inspect or initiate rollback recovery |
| `/sessions` | List saved interactive CLI sessions |
| `/delete-session <id>` | Delete a saved session from storage |
| `/clear` | Clear terminal conversation scrollback |
| `/exit` | Persist current session state and exit FeCode |

*For complete usage documentation, see [CLI Usage](docs/v1/cli-usage.md).*

---

## Keyboard Shortcuts

| Keybinding | Action | Context |
| :--- | :--- | :--- |
| `Tab` | Autocomplete selected slash command | Command input |
| `↑` / `↓` | Navigate autocomplete suggestions | Command palette |
| `Ctrl + C` | Cancel current generation / Cancel pending approval / Exit | Universal |
| `Esc` | Return to main terminal view | Secondary views (Help, Runs, Diagnostics) |
| `y` / `Enter` | Submit approval decision (`yes`) | Approval prompt |
| `n` / `c` | Submit rejection decision (`no` / `cancel`) | Approval prompt |

---

## Git Awareness & Workspace Tracking

FeCode integrates with Git to protect against silent data loss:
- **Baseline Snapshots**: Captures repository commit hash, branch, and untracked file state before task execution starts.
- **Drift Detection**: Detects if files were modified externally while a plan was in progress.
- **Attribution & Diffing**: Segregates changes made by FeCode from pre-existing uncommitted user changes.
- **No Automatic Commits**: FeCode **never** executes `git commit` or `git push` automatically. You retain complete authority over your commit history.

---

## Diagnostics & Durable History

Every execution creates a durable, sanitized run record on disk:
- **Telemetry**: Records tool invocation latencies, token consumption, and model round-trips.
- **Sanitized Storage**: Credentials, environment variables, and private auth headers are stripped prior to serialization.
- **Audit Trails**: Inspect any run using `/run <id>` or view active performance via `/diagnostics`.

*Learn more in the [Diagnostics & Telemetry Guide](docs/v1/diagnostics.md).*

---

## Monorepo & Development

### Repository Structure

```text
fecode/
├── apps/
│   └── cli/            # Ink / React interactive terminal app (@fecode/cli)
├── packages/
│   ├── agent/          # Agent runtime, planning, checkpoints, recovery (@fecode/agent)
│   ├── models/         # Model providers (Gemini, OpenAI, Ollama) (@fecode/models)
│   └── shared/         # Common utilities, config loader, logger (@fecode/shared)
├── docs/v1/            # Comprehensive technical documentation
└── assets/             # Project visual assets
```

### Development Commands

```bash
# Build all packages
npm run build

# Start interactive CLI in development mode (tsx)
npm run dev

# Run strict TypeScript compiler checks
npm run typecheck

# Run ESLint across entire codebase
npm run lint

# Run full Vitest automated test suite
npm test
```

---

## Contributing

We welcome contributions from the community! Please read our [Contributing Guide](CONTRIBUTING.md) for setup instructions, coding conventions, and pull request workflows.

---

## Security Policy

For vulnerability reporting guidelines and our security policy, please review [SECURITY.md](SECURITY.md).

---

## License

FeCode is open-source software licensed under the [MIT License](LICENSE).  
Copyright (c) 2026 Abhijat Sinha.
