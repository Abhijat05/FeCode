#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { createModelProvider } from "@fecode/models";
import { AgentRuntime, createDefaultToolRegistry } from "@fecode/agent";
import { App } from "./App.js";

function main(): void {
  let agent: AgentRuntime | undefined;
  let configError: string | undefined;

  try {
    const providerName = process.env.FE_PROVIDER || "openai";
    const modelName = process.env.FE_MODEL || "gpt-4o";

    const modelProvider = createModelProvider({
      provider: providerName,
      model: modelName
    });

    const registry = createDefaultToolRegistry();

    agent = new AgentRuntime(modelProvider, { registry });
  } catch (err: unknown) {
    configError = err instanceof Error ? err.message : String(err);
  }

  render(
    <App
      agent={agent}
      cwd={process.cwd()}
      configError={configError}
    />
  );
}

main();
