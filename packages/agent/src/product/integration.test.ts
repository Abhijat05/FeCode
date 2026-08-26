import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { DefaultProductRuntime } from "./productRuntime.js";
import { DefaultToolRegistry, type ModelProvider } from "@fecode/models";
import {
  selectApplicationShellProps,
  selectPlanViewerProps,
  selectExecutionTimelineProps,
  selectRunStatusProps
} from "./components.js";

const DEFAULT_CAPS = {
  streaming: true,
  toolCalling: true,
  vision: false,
  maxContextTokens: 4096
};

describe("Phase 5AC — Product Shell & UI Integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-prod-integ-"));
    await fs.writeFile(path.join(tmpDir, "src-test.ts"), "export const a = 1;\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("coordinates full task lifecycle through ProductRuntime into UI component selectors", async () => {
    const mockProvider: ModelProvider = {
      id: "mock-model",
      capabilities: DEFAULT_CAPS,
      async *generate() {
        yield {
          type: "text_delta",
          content: "Plan execution complete."
        };
        yield { type: "completed" };
      }
    };

    const registry = new DefaultToolRegistry();
    const runtime = new AgentRuntime(mockProvider, {
      registry
    });

    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      initialCwd: tmpDir
    });

    const timelineEvents: string[] = [];
    for await (const ev of productRuntime.submitTask({
      message: "Refactor core codebase",
      cwd: tmpDir
    })) {
      if (ev.type === "ui_state_changed") {
        timelineEvents.push(ev.state.status);
      }
    }

    const state = productRuntime.getUIState();
    expect(state.status).toBe("completed");

    // Test component selectors
    const shellProps = selectApplicationShellProps(state);
    expect(shellProps.status).toBe("completed");
    expect(shellProps.cwd).toBe(tmpDir);

    const runStatusProps = selectRunStatusProps(state);
    expect(runStatusProps.isCompleted).toBe(true);
    expect(runStatusProps.hasFailed).toBe(false);

    const timelineProps = selectExecutionTimelineProps(state);
    expect(timelineProps.totalEvents).toBeGreaterThan(0);

    const planProps = selectPlanViewerProps(state);
    expect(planProps).toBeDefined();
  });

  it("ensures UI cannot mutate internal runtime state through returned snapshots", () => {
    const mockProvider: ModelProvider = {
      id: "mock-model",
      capabilities: DEFAULT_CAPS,
      async *generate() {
        yield { type: "text_delta", content: "ok" };
      }
    };

    const runtime = new AgentRuntime(mockProvider, {});
    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      initialCwd: tmpDir
    });

    const state1 = productRuntime.getUIState();
    // Attempt mutation
    state1.status = "executing";
    state1.timeline.push({
      id: "fake",
      type: "error",
      title: "Fake error",
      timestamp: Date.now()
    });

    const state2 = productRuntime.getUIState();
    expect(state2.status).toBe("idle");
    expect(state2.timeline.length).toBe(0);
  });
});
