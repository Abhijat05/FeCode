# FeCode

FeCode is a terminal coding agent specialized for frontend developers.

## Repository Structure

```text
feCode/
├── apps/
│   └── cli/          # Ink CLI interface
├── packages/
│   ├── agent/        # Agent interface and event definitions
│   ├── models/       # Model provider interfaces
│   └── shared/       # Shared common types (ID, etc.)
├── package.json      # Monorepo root config (npm workspaces)
└── tsconfig.json     # Strict TypeScript configuration
```

## Dependency Hierarchy

```text
cli → agent → models → shared
```

## Setup & Installation

Ensure you have Node.js (v20+) and npm installed.

```bash
# Install all dependencies across workspaces
npm install

# Build all packages and CLI
npm run build

# Run unit tests across all workspaces
npm run test

# Run linter & type checks
npm run lint

# Start the interactive CLI
npm run fe
```
