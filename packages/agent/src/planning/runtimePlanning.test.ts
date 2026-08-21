import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { DefaultRunHistoryStore } from "../history/runHistoryStore.js";
import { DefaultToolRegistry } from "@fecode/models";
import type {
  ModelProvider,
  ModelRequest,
  ModelEvent
} from "@fecode/models";
import type { AgentEvent } from "../index.js";

class MockProvider implements ModelProvider {
  public id = "mock-planning-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  private readonly responses: Array<(req: ModelRequest) => AsyncIterable<ModelEvent>>;

  constructor(responses: Array<(req: ModelRequest) => AsyncIterable<ModelEvent>>) {
    this.responses = [...responses];
  }

  async *generate(req: ModelRequest): AsyncIterable<ModelEvent> {
    const fn = this.responses.shift();
    if (!fn) {
      yield { type: "text_delta", content: "Done." };
      return;
    }
    yield* fn(req);
  }
}

describe("Runtime Planning Integration — Phase 5P", () => {
  let tmpDir: string;
  let historyDir: string;
  let historyStore: DefaultRunHistoryStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-plan-runtime-"));
    historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-plan-history-"));
    await fs.writeFile(path.join(tmpDir, "app.ts"), "export const val = 42;\n", "utf-8");
    historyStore = new DefaultRunHistoryStore({ storageDir: historyDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(historyDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("creates a structured TaskPlan during planning and records it in diagnostics and history", async () => {
    const provider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Plan completed successfully." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      historyStore,
      emitRunEvents: true
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Refactor core logic in app.ts",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const planCreatedEv = events.find((e) => e.type === "plan_created");
    expect(planCreatedEv).toBeDefined();

    const plan = runtime.getTaskPlan();
    expect(plan).toBeDefined();
    expect(plan?.status).toBe("completed");
    expect(plan?.steps.length).toBeGreaterThan(0);

    const summary = runtime.getLatestRunSummary();
    expect(summary?.planId).toBe(plan?.planId);
    expect(summary?.planStatus).toBe("completed");
    expect(summary?.totalPlanSteps).toBe(plan?.steps.length);
  });

  it("tracks plan step progression as tools execute", async () => {
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "read_file",
      description: "Read",
      permissionCategory: "read",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "content" })
    });

    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-read-1",
            name: "read_file",
            arguments: { path: "app.ts" }
          }
        };
      },
      async function* () {
        yield { type: "text_delta", content: "Finished inspection." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      registry,
      historyStore,
      emitRunEvents: true
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Inspect app.ts",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const stepCompletedEv = events.find((e) => e.type === "plan_step_completed");
    expect(stepCompletedEv).toBeDefined();

    const summary = runtime.getLatestRunSummary();
    expect(summary?.completedPlanSteps).toBeGreaterThanOrEqual(1);
  });

  it("marks plan as cancelled upon cancellation", async () => {
    const runtimeContainer: { runtime?: AgentRuntime } = {};
    const provider = new MockProvider([
      async function* () {
        if (runtimeContainer.runtime) {
          await runtimeContainer.runtime.cancel();
        }
        yield { type: "text_delta", content: "Working..." };
      }
    ]);

    const runtime = new AgentRuntime(provider, { historyStore });
    runtimeContainer.runtime = runtime;

    for await (const ev of runtime.run({
      message: "Long task",
      cwd: tmpDir
    })) {
      void ev;
    }

    const plan = runtime.getTaskPlan();
    expect(plan?.status).toBe("cancelled");

    const summary = runtime.getLatestRunSummary();
    expect(summary?.planStatus).toBe("cancelled");
  });

  it("generates a NEW plan on resume without reusing or mutating the parent plan", async () => {
    // 1. First run that fails
    const providerFail = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Starting..." };
        throw new Error("Simulated failure during execution");
      }
    ]);

    const runtime1 = new AgentRuntime(providerFail, { historyStore });
    try {
      for await (const ev of runtime1.run({
        message: "Implement feature X",
        cwd: tmpDir
      })) {
        void ev;
      }
    } catch {
      // expected error
    }

    const parentPlan = runtime1.getTaskPlan();
    expect(parentPlan).toBeDefined();
    expect(parentPlan?.status).toBe("failed");
    const parentRunId = runtime1.getLatestRunSummary()?.runId;
    expect(parentRunId).toBeDefined();

    // 2. Resume run
    const providerSuccess = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Resumed and completed." };
      }
    ]);

    const runtime2 = new AgentRuntime(providerSuccess, { historyStore });
    for await (const ev of runtime2.resumeRun(parentRunId!, {
      cwd: tmpDir,
      approved: true
    })) {
      void ev;
    }

    const resumedPlan = runtime2.getTaskPlan();
    expect(resumedPlan).toBeDefined();
    expect(resumedPlan?.planId).not.toBe(parentPlan?.planId);
    expect(resumedPlan?.status).toBe("completed");

    // Parent plan in historical store remains unchanged
    const parentInStore = await historyStore.getRun(parentRunId!);
    expect(parentInStore?.planId).toBe(parentPlan?.planId);
    expect(parentInStore?.planStatus).toBe("failed");
  });
});
