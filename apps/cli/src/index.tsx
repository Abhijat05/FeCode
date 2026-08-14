#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "@fecode/shared";
import { createModelProvider } from "@fecode/models";
import { AgentRuntime, createDefaultToolRegistry, ProjectDetector, SkillLoader, DefaultSkillRegistry, SkillActivationPolicy } from "@fecode/agent";
import type { ProjectContext } from "@fecode/agent";
import { App } from "./App.js";
import { InteractiveApprovalResolver } from "./approvalResolver.js";

async function main(): Promise<void> {
  let agent: AgentRuntime | undefined;
  let configError: string | undefined;
  let projectContext: ProjectContext | undefined;

  const cwd = process.cwd();
  
  try {
    const detector = new ProjectDetector();
    projectContext = await detector.detect(cwd);
  } catch {
    // Ignore detection errors, continue without context
  }

  const config = loadConfig();
  const providerName = config.provider;
  const modelName = config.model;

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
    const builtinSkills = await skillLoader.discoverSkills(skillLoader.getBuiltinSkillsDir());
    for (const s of builtinSkills) {
      skillRegistry.register(s);
    }

    agent = new AgentRuntime(modelProvider, {
      registry,
      approvalResolver,
      projectContext,
      skillRegistry,
      activationPolicy
    });
  } catch (err: unknown) {
    configError = err instanceof Error ? err.message : String(err);
  }

  render(
    <App
      agent={agent}
      cwd={cwd}
      providerName={providerName}
      modelName={modelName}
      approvalResolver={approvalResolver}
      configError={configError}
      projectContext={projectContext}
    />
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
