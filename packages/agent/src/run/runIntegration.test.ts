import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import { DefaultToolRegistry } from "@fecode/models";
import type { ModelProvider, ModelRequest, ModelEvent, Tool } from "@fecode/models";
import type { CheckpointResult } from "../checkpoints/types.js";

class MockProvider implements ModelProvider {
  public id = "mock-run-provider";
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

describe("AgentRuntime Run State & Lifecycle Integration — Phase 5K", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-run-int-"));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-run-store-"));
    await fs.writeFile(path.join(tmpDir, "index.ts"), "const a = 1;\n", "utf-8");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("orchestrates full task lifecycle with run events enabled", async () => {
    const provider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "I will modify the file." };
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "echo",
            arguments: { message: "hello" }
          }
        };
      },
      async function* () {
        yield { type: "text_delta", content: "All done!" };
      }
    ]);

    const registry = new DefaultToolRegistry();
    const echoTool: Tool = {
      name: "echo",
      description: "Echo",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "hello" })
    };
    registry.register(echoTool);

    const runtime = new AgentRuntime(provider, {
      registry,
      emitRunEvents: true
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Echo hello", cwd: tmpDir })) {
      events.push(ev);
    }

    const stateMachine = runtime.getRunStateMachine();
    expect(stateMachine).toBeDefined();
    expect(stateMachine?.getState()).toBe("completed");
    expect(stateMachine?.isTerminal()).toBe(true);

    const runStarted = events.find((e) => e.type === "run_started");
    const runCompleted = events.find((e) => e.type === "run_completed");
    const stateChanges = events.filter((e) => e.type === "state_changed");

    expect(runStarted).toBeDefined();
    expect(runCompleted).toBeDefined();
    expect(stateChanges.length).toBeGreaterThanOrEqual(2);
    expect(stateChanges[0]).toMatchObject({
      type: "state_changed",
      from: "idle",
      to: "planning"
    });
  });

  it("handles checkpoint failure by blocking mutation and safely failing run", async () => {
    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-write",
            name: "write_file",
            arguments: { path: "package.json", content: "{\"name\": \"fecode\"}" }
          }
        };
      }
    ]);

    const registry = new DefaultToolRegistry();
    let writeExecuted = false;
    const writeTool: Tool = {
      name: "write_file",
      description: "Write file",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => {
        writeExecuted = true;
        return { success: true, output: "written" };
      }
    };
    registry.register(writeTool);

    const failingCheckpointManager = {
      create: async (): Promise<CheckpointResult> => ({
        success: false,
        error: "Disk full / permission denied",
        code: "CHECKPOINT_FAILED"
      }),
      get: async () => null,
      inspect: async () => null,
      compare: async () => ({
        checkpointId: "",
        createdAt: "",
        files: [],
        totalAdditions: 0,
        totalDeletions: 0
      }),
      list: async () => [],
      remove: async () => {},
      discard: async () => {},
      restore: async () => ({
        success: false,
        checkpointId: "",
        status: "failed" as const,
        recoveredFiles: [],
        preservedFiles: [],
        conflicts: []
      })
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      checkpointManager: failingCheckpointManager
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Refactor all files and update package.json",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    // Write should NOT have executed!
    expect(writeExecuted).toBe(false);

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("CHECKPOINT_FAILED");
    }
  });

  it("handles cancellation cleanly and sets terminal state to cancelled", async () => {
    const provider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Starting long task..." };
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "long_task",
            arguments: {}
          }
        };
      }
    ]);

    const registry = new DefaultToolRegistry();
    let runtimeRef: AgentRuntime | null = null;
    const longTaskTool: Tool = {
      name: "long_task",
      description: "Long task",
      inputSchema: { type: "object" },
      execute: async () => {
        if (runtimeRef) {
          await runtimeRef.cancel();
        }
        return { success: true };
      }
    };
    registry.register(longTaskTool);

    const runtime = new AgentRuntime(provider, {
      registry,
      emitRunEvents: true
    });
    runtimeRef = runtime;

    const events: AgentEvent[] = [];
    try {
      for await (const ev of runtime.run({ message: "Do long task", cwd: tmpDir })) {
        events.push(ev);
      }
    } catch {
      // Cancellation might throw or exit
    }

    const stateMachine = runtime.getRunStateMachine();
    expect(stateMachine).toBeDefined();
    expect(stateMachine?.getState()).toBe("cancelled");
    expect(stateMachine?.isTerminal()).toBe(true);
  });
});
