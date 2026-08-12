#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadConfig } from "@fecode/shared";
import { createModelProvider } from "@fecode/models";
import { AgentRuntime, createDefaultToolRegistry } from "@fecode/agent";
import { App } from "./App.js";
import { InteractiveApprovalResolver } from "./approvalResolver.js";

function main(): void {
  let agent: AgentRuntime | undefined;
  let configError: string | undefined;

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

    agent = new AgentRuntime(modelProvider, {
      registry,
      approvalResolver
    });
  } catch (err: unknown) {
    configError = err instanceof Error ? err.message : String(err);
  }

  render(
    <App
      agent={agent}
      cwd={process.cwd()}
      providerName={providerName}
      modelName={modelName}
      approvalResolver={approvalResolver}
      configError={configError}
    />
  );
}

main();
