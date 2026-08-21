import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import { DefaultToolRegistry } from "@fecode/models";
import type { ModelProvider, ModelRequest, ModelEvent, Tool } from "@fecode/models";

class MockProvider implements ModelProvider {
  public id = "mock-diag-provider";
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

describe("Run Observability & Diagnostics Integration — Phase 5M", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-diag-int-"));
    await fs.writeFile(path.join(tmpDir, "index.ts"), "const a = 1;\n", "utf-8");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("captures comprehensive run record and guarantees strict event ordering", async () => {
    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "echo",
            arguments: { message: "diagnostic test" }
          }
        };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
      },
      async function* () {
        yield { type: "text_delta", content: "Completed diagnostics." };
      }
    ]);

    const registry = new DefaultToolRegistry();
    const echoTool: Tool = {
      name: "echo",
      description: "Echo",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "diagnostic test" })
    };
    const execTool: Tool = {
      name: "execute_command",
      description: "Execute",
      permissionCategory: "execute",
      inputSchema: { type: "object" },
      execute: async () => ({
        success: true,
        output: { exitCode: 0, stdout: "PASS", stderr: "" }
      })
    };
    registry.register(echoTool);
    registry.register(execTool);

    const runtime = new AgentRuntime(provider, {
      registry,
      emitRunEvents: true,
      approvalResolver: { resolve: async () => ({ approved: true }) }
    });

    const emittedEvents: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Test diagnostics with API key sk-test1234567890abcdef12345678",
      cwd: tmpDir
    })) {
      emittedEvents.push(ev);
    }

    // 1. Run Summary Verification
    const summary = runtime.getLatestRunSummary();
    expect(summary).toBeDefined();
    expect(summary?.finalStatus).toBe("completed");
    expect(summary?.tools.length).toBe(2);
    expect(summary?.tools.map((t) => t.toolName)).toEqual(["echo", "execute_command"]);
    expect(summary?.commands.length).toBe(1);
    expect(summary?.commands[0].command).toBe("npm test");
    expect(summary?.commands[0].succeeded).toBe(true);
    expect(summary?.durationMs).toBeGreaterThanOrEqual(0);

    // Security: Redacted API key
    expect(summary?.userRequestSummary).not.toContain("sk-test1234567890abcdef12345678");
    expect(summary?.userRequestSummary).toContain("[REDACTED_API_KEY]");

    // 2. Event Ordering Verification
    const events = runtime.getRunEvents(summary!.runId);
    expect(events).toBeDefined();
    expect(events!.length).toBeGreaterThanOrEqual(5);

    // Guarantee 1: run_started is the first event
    expect(events![0].type).toBe("run_started");

    // Guarantee 2: run_completed is the terminal event
    const lastEvent = events![events!.length - 1];
    expect(lastEvent.type).toBe("run_completed");

    // Guarantee 3: tool_started precedes tool_completed
    const toolStartedIdx = events!.findIndex((e) => e.type === "tool_started" && e.callId === "call-1");
    const toolCompletedIdx = events!.findIndex((e) => e.type === "tool_completed" && e.callId === "call-1");
    expect(toolStartedIdx).toBeGreaterThan(-1);
    expect(toolCompletedIdx).toBeGreaterThan(toolStartedIdx);

    // Guarantee 4: verification_started precedes verification_completed
    const vStartIdx = events!.findIndex((e) => e.type === "verification_started");
    const vCompIdx = events!.findIndex((e) => e.type === "verification_completed");
    expect(vStartIdx).toBeGreaterThan(-1);
    expect(vCompIdx).toBeGreaterThan(vStartIdx);
  });

  it("captures failure diagnostics upon verification exhaustion", async () => {
    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-fail-1",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
      }
    ]);

    const registry = new DefaultToolRegistry();
    const execTool: Tool = {
      name: "execute_command",
      description: "Execute",
      permissionCategory: "execute",
      inputSchema: { type: "object" },
      execute: async () => ({
        success: false,
        output: { exitCode: 1, stdout: "", stderr: "Test failure" }
      })
    };
    registry.register(execTool);

    const runtime = new AgentRuntime(provider, {
      registry,
      emitRunEvents: true,
      maxVerificationAttempts: 1
    });

    const failEvents: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Run tests", cwd: tmpDir })) {
      failEvents.push(ev);
    }
    expect(failEvents.length).toBeGreaterThan(0);

    const summary = runtime.getLatestRunSummary();
    expect(summary).toBeDefined();
    expect(summary?.finalStatus).toBe("failed");
    expect(summary?.verificationAttempts).toBe(1);
    expect(summary?.failureReason).toContain("Verification failed after 1 attempts");

    const events = runtime.getRunEvents(summary!.runId);
    expect(events).toBeDefined();
    const lastEvent = events![events!.length - 1];
    expect(lastEvent.type).toBe("run_failed");
  });

  it("captures cancellation diagnostics when cancelled during execution", async () => {
    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-cancel",
            name: "cancel_tool",
            arguments: {}
          }
        };
      }
    ]);

    const registry = new DefaultToolRegistry();
    let runtimeRef: AgentRuntime | null = null;
    const cancelTool: Tool = {
      name: "cancel_tool",
      description: "Cancel",
      inputSchema: { type: "object" },
      execute: async () => {
        if (runtimeRef) {
          await runtimeRef.cancel();
        }
        return { success: true };
      }
    };
    registry.register(cancelTool);

    const runtime = new AgentRuntime(provider, {
      registry,
      emitRunEvents: true
    });
    runtimeRef = runtime;

    const cancelEvents: AgentEvent[] = [];
    try {
      for await (const ev of runtime.run({ message: "Cancel test", cwd: tmpDir })) {
        cancelEvents.push(ev);
      }
    } catch {
      // Ignore
    }
    expect(cancelEvents.length).toBeGreaterThan(0);

    const summary = runtime.getLatestRunSummary();
    expect(summary).toBeDefined();
    expect(summary?.finalStatus).toBe("cancelled");
    expect(summary?.cancellationReason).toBeDefined();

    const events = runtime.getRunEvents(summary!.runId);
    expect(events).toBeDefined();
    const lastEvent = events![events!.length - 1];
    expect(lastEvent.type).toBe("run_cancelled");
  });
});
