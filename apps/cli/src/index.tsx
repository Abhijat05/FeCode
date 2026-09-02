#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "@fecode/shared";
import { createModelProvider } from "@fecode/models";
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

  const sessionStore = new DefaultSessionStore();
  let cwd = process.cwd();

  // Parse --resume / -r argument
  const args = process.argv.slice(2);
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
      try {
        await fs.stat(cwd);
      } catch {
        console.error(
          `⚠ Working directory no longer exists\n\nPath:\n  ${cwd}\n`
        );
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Session not found") || msg.includes("corrupted") || msg.includes("version")) {
        console.error(`✗ ${msg}`);
      } else {
        console.error(`✗ Unable to load session\n\nSession:\n  ${resumeId}\n\nReason:\n  ${msg}\n`);
      }
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

    const modelProvider = createModelProvider({
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
