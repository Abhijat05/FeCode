#!/usr/bin/env node
import { render } from "ink";
import { loadConfig } from "@fecode/shared";
import { createModelProvider, createConfiguredFallbackChain } from "@fecode/models";
import * as fs from "fs/promises";
import {
  AgentRuntime,
  createDefaultToolRegistry,
  ProjectDetector,
  SkillLoader,
  DefaultSkillRegistry,
  registerBuiltinSkills,
  SkillActivationPolicy,
  DefaultSessionStore,
  DefaultRunHistoryStore,
  DefaultProductRuntime,
  type PersistedSessionData
} from "@fecode/agent";
import type { ProjectContext } from "@fecode/agent";
import { App } from "./App.js";
import { InteractiveApprovalResolver } from "./approvalResolver.js";

async function main(): Promise<void> {
  let agent: AgentRuntime | undefined;
  let configError: string | undefined;
  let projectContext: ProjectContext | undefined;
  let initialSessionData: PersistedSessionData | undefined;

  const args = process.argv.slice(2);

  // Check --version / -v
  if (args.includes("--version") || args.includes("-v")) {
    console.log("1.0.2");
    process.exit(0);
  }

  // Check --help / -h
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`FeCode - Interactive Terminal Coding Assistant (v1.0.2)

Usage:
  fe [options]
  fecode [options]

Options:
  -v, --version       Display FeCode version
  -h, --help          Display this help message
  -r, --resume <id>   Resume a previous session or historical run by ID

Environment Variables:
  FE_PROVIDER         LLM provider ('gemini', 'openai', 'ollama') [default: gemini]
  FE_MODEL            Model name [default: gemini-2.5-flash / gpt-4o / qwen2.5-coder]
  GEMINI_API_KEY      API key for Google Gemini provider
  OPENAI_API_KEY      API key for OpenAI provider
  OLLAMA_BASE_URL     Base URL for Ollama provider [default: http://localhost:11434/v1]

Interactive Commands (inside TUI):
  /help               Show in-terminal command list
  /plan [id]          Display active plan or details for a run
  /replan             Trigger plan re-evaluation and adaptation
  /resume <id>        Prepare resume for historical run
  /diagnostics [id]   Show diagnostics and telemetry for active/specified run
  /runs [limit]       List historical runs for current project
  /git                Inspect Git workspace status and modified files
  /clear              Clear conversation turns
  /exit               Exit FeCode`);
    process.exit(0);
  }

  const sessionStore = new DefaultSessionStore();
  let cwd = process.cwd();

  // Parse --resume / -r argument
  let resumeId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--resume" || args[i] === "-r") && i + 1 < args.length) {
      resumeId = args[i + 1];
      break;
    }
  }

  if (resumeId) {
    try {
      initialSessionData = await sessionStore.load(resumeId);
      cwd = initialSessionData.workingDirectory;
    } catch (err: unknown) {
      const historyStore = new DefaultRunHistoryStore();
      const runRecord = await historyStore.getRun(resumeId);
      if (runRecord) {
        initialSessionData = {
          version: 1,
          sessionId: runRecord.runId,
          workingDirectory: runRecord.cwd || process.cwd(),
          provider: "gemini",
          model: "gemini-2.5-flash",
          startedAt: new Date(runRecord.startedAt).toISOString(),
          updatedAt: new Date(
            runRecord.completedAt || runRecord.startedAt
          ).toISOString(),
          taskCount: runRecord.tools.length,
          status: runRecord.finalStatus === "completed" ? "completed" : "idle",
          completedTaskSummaries: [],
          messages: []
        };
        cwd = initialSessionData.workingDirectory;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("Session not found") ||
          msg.includes("corrupted") ||
          msg.includes("version")
        ) {
          console.error(`✗ ${msg}`);
        } else {
          console.error(
            `✗ Unable to load session\n\nSession:\n  ${resumeId}\n\nReason:\n  ${msg}\n`
          );
        }
        process.exit(1);
      }
    }

    try {
      await fs.stat(cwd);
    } catch {
      console.error(
        `⚠ Working directory no longer exists\n\nPath:\n  ${cwd}\n`
      );
      process.exit(1);
    }
  }

  try {
    const detector = new ProjectDetector();
    projectContext = await detector.detect(cwd);
  } catch {
    // Ignore detection errors, continue without context
  }

  const config = loadConfig();
  // Precedence: explicit env vars > persisted session config > defaults
  const providerName =
    process.env.FE_PROVIDER ||
    initialSessionData?.provider ||
    config.provider ||
    "gemini";
  const modelName =
    process.env.FE_MODEL ||
    initialSessionData?.model ||
    (providerName === "openai"
      ? "gpt-4o"
      : providerName === "ollama"
        ? "qwen2.5-coder"
        : "gemini-2.5-flash");

  const approvalResolver = new InteractiveApprovalResolver();

  try {
    const apiKey =
      providerName === "gemini"
        ? config.geminiApiKey
        : providerName === "openai"
          ? config.openaiApiKey
          : undefined;

    const modelProvider = config.fallback?.enabled
      ? createConfiguredFallbackChain({
          primaryProvider: providerName,
          primaryModel: modelName,
          fallbackProviders: config.fallback.providers,
          geminiApiKey: config.geminiApiKey,
          openaiApiKey: config.openaiApiKey,
          ollamaBaseUrl: config.ollamaBaseUrl,
          maxRetriesPerProvider: config.fallback.maxRetriesPerProvider,
          maxTotalFallbackSwitches: config.fallback.maxTotalFallbackSwitches
        })
      : createModelProvider({
          provider: providerName,
          model: modelName,
          apiKey,
          baseUrl: config.ollamaBaseUrl
        });

    const registry = createDefaultToolRegistry();
    const skillLoader = new SkillLoader();
    const skillRegistry = new DefaultSkillRegistry();
    const activationPolicy = new SkillActivationPolicy();

    // We can lazily load built-in skills asynchronously.
    registerBuiltinSkills(skillRegistry);
    const builtinSkills = await skillLoader.discoverSkills(skillLoader.getBuiltinSkillsDir());
    for (const s of builtinSkills) {
      skillRegistry.register(s);
    }

    agent = new AgentRuntime(modelProvider, {
      registry,
      approvalResolver,
      projectContext,
      skillRegistry,
      activationPolicy,
      sessionId: initialSessionData?.sessionId
    });

    if (initialSessionData) {
      agent.restoreSession(initialSessionData);
    }
  } catch (err: unknown) {
    configError = err instanceof Error ? err.message : String(err);
  }

  const productRuntime = agent
    ? new DefaultProductRuntime({
        agentRuntime: agent,
        approvalResolver,
        initialCwd: cwd,
        initialSessionId: initialSessionData?.sessionId
      })
    : undefined;

  // Ensure TTY before launching interactive Ink TUI
  if (!process.stdin.isTTY && !process.env.VITEST && !process.env.CI_TEST_MODE) {
    console.error("✗ FeCode requires an interactive terminal (TTY).\nRun with --help for available options.");
    process.exit(1);
  }

  // Clear terminal screen and position cursor at Row 1, Column 1 in interactive mode
  // to give Ink full vertical headroom and prevent scrollback ghosting
  if (process.stdout.isTTY && !process.env.VITEST && !process.env.CI_TEST_MODE) {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  render(
    <App
      agent={agent}
      productRuntime={productRuntime}
      cwd={cwd}
      providerName={providerName}
      modelName={modelName}
      approvalResolver={approvalResolver}
      configError={configError}
      projectContext={projectContext}
      sessionStore={sessionStore}
      initialSessionData={initialSessionData}
    />
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
