# FeCode

FeCode is a terminal coding agent specialized for frontend developers.

## Repository Structure

```text
feCode/
├── apps/
│   └── cli/          # Ink CLI interface
├── packages/
│   ├── agent/        # Agent runtime and tool definitions
│   ├── models/       # Model provider layer (OpenAI, Gemini, Ollama)
│   └── shared/       # Shared common types (ID, etc.)
├── package.json      # Monorepo root config (npm workspaces)
└── tsconfig.json     # Strict TypeScript configuration
```

## Dependency Hierarchy

```text
cli → agent → models → shared
```

## Supported Providers & Configuration

Configure model access using `FE_PROVIDER` (`openai`, `gemini`, `ollama`):

```bash
# Model Selection (Optional)
export FE_PROVIDER="openai" # options: openai, gemini, ollama (default: openai)
export FE_MODEL="gpt-4o"     # optional override
```

### 1. OpenAI Setup

```bash
export FE_PROVIDER="openai"
export FE_MODEL="gpt-4o"
export OPENAI_API_KEY="your-openai-api-key"
```

### 2. Google Gemini Setup

```bash
export FE_PROVIDER="gemini"
export FE_MODEL="gemini-2.5-flash"
export GEMINI_API_KEY="your-gemini-api-key"
```

### 3. Local Ollama Setup

```bash
# Ensure local Ollama is running and model is pulled: ollama pull qwen2.5-coder
export FE_PROVIDER="ollama"
export FE_MODEL="qwen2.5-coder"
export OLLAMA_BASE_URL="http://localhost:11434/v1" # optional override
```

## Setup & Running Locally

Ensure Node.js (v20+) and npm are installed.

```bash
# Install dependencies
npm install

# Build all workspace packages
npm run build

# Run unit test suite
npm run test

# Run linter & type checks
npm run lint

# Start interactive FeCode CLI
npm run fe
```
