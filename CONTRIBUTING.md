# Contributing to FeCode

Thank you for your interest in contributing to FeCode! FeCode is a safety-first, plan-driven terminal coding assistant.

---

## Code of Conduct & Core Principles

1. **Safety First**: Protected operations (file modifications, shell commands) must route through the authoritative `ExecutionHandoffManager`. Never introduce bypass paths or autonomous background loops.
2. **Explicit User Control**: Users must approve elevated actions. Authorizations are single-use and never inherited across runs, steps, or resumes.
3. **Strict Quality Gates**: Zero TypeScript errors, zero linter warnings, 100% test pass rate, and full packaging compliance.

---

## Development Setup

### Prerequisites
- Node.js `>= 20.0.0`
- npm `>= 10.0.0`
- Git `>= 2.30.0`

### Initializing the Monorepo

```bash
# Clone the repository
git clone https://github.com/Abhijat05/FeCode.git
cd FeCode

# Install dependencies across all workspaces
npm install

# Build all packages
npm run build
```

---

## Monorepo Layout

```text
fecode/
├── apps/
│   └── cli/          # Ink / React interactive terminal application (@fecode/cli)
├── packages/
│   ├── agent/        # Core agent runtime, planning, permissions, checkpoints (@fecode/agent)
│   ├── models/       # Provider abstractions for Gemini, OpenAI, and Ollama (@fecode/models)
│   └── shared/       # Shared configuration loader and common utilities (@fecode/shared)
├── docs/v1/          # Comprehensive V1 technical documentation
└── assets/           # Project visuals and branding
```

---

## Verification & Quality Gates

Every pull request must satisfy all four quality gates:

```bash
# 1. Typecheck (strict mode, no unused locals/params)
npm run typecheck

# 2. Linting (ESLint + TypeScript-ESLint)
npm run lint

# 3. Production Build
npm run build

# 4. Vitest Test Suite
npm test
```

### Running Specific Test Suites

```bash
# V1 Acceptance Scenarios (18/18)
npx vitest run packages/agent/src/test/v1Acceptance.test.ts

# Release Candidate Scenarios (15/15)
npx vitest run apps/cli/src/rcScenarios.test.tsx

# Security Invariants (17/17)
npx vitest run packages/agent/src/test/v1SecurityInvariants.test.ts

# Packaging & Tarball Invariants (13/13)
npx vitest run apps/cli/src/packaging.test.ts
```

---

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names like `fix/issue-description` or `docs/update-section`.
2. **Commit Messages**: Write clear, conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`).
3. **No Dead Code**: Ensure no unused variables or unreferenced imports remain.
4. **Documentation**: If your change modifies CLI flags, slash commands, or runtime configuration, update the relevant documentation in `docs/v1/` and `README.md`.
