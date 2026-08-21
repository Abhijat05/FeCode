import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { DefaultRunHistoryStore } from "./runHistoryStore.js";
import { DefaultToolRegistry } from "@fecode/models";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import type { AgentEvent } from "../index.js";

class MockProvider implements ModelProvider {
  public id = "mock-history-provider";
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

describe("Durable Run History & Explicit Resume Integration — Phase 5N", () => {
  let tmpDir: string;
  let historyDir: string;
  let historyStore: DefaultRunHistoryStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-hist-int-"));
    historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-hist-store-"));
    await fs.writeFile(path.join(tmpDir, "index.ts"), "export const a = 1;\n", "utf-8");
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

  it("persists run record upon completion and allows inspection through history store", async () => {
    const provider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Completed execution." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      historyStore
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Run a simple task",
      cwd: tmpDir
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    const latest = runtime.getLatestRunSummary();
    expect(latest).toBeDefined();

    // Verify stored in history
    const storedRun = await historyStore.getRun(latest!.runId);
    expect(storedRun).toBeDefined();
    expect(storedRun?.finalStatus).toBe("completed");
    expect(storedRun?.schemaVersion).toBe(1);
    expect(storedRun?.cwd).toBe(tmpDir);
  });

  it("supports explicit user resume with fresh identity without mutating parent run", async () => {
    // 1. First run that fails
    const failProvider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-fail",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
      }
    ]);

    const registry = new DefaultToolRegistry();
    registry.register({
      name: "execute_command",
      description: "Exec",
      permissionCategory: "execute",
      inputSchema: { type: "object" },
      execute: async () => ({
        success: false,
        output: { exitCode: 1, stdout: "", stderr: "Test failure" }
      })
    });

    const runtime = new AgentRuntime(failProvider, {
      registry,
      historyStore,
      maxVerificationAttempts: 1
    });

    const firstRunEvents: AgentEvent[] = [];
    for await (const ev of runtime.run({
      message: "Fix tests",
      cwd: tmpDir
    })) {
      firstRunEvents.push(ev);
    }
    expect(firstRunEvents.length).toBeGreaterThan(0);

    const firstRunSummary = runtime.getLatestRunSummary();
    expect(firstRunSummary).toBeDefined();
    expect(firstRunSummary?.finalStatus).toBe("failed");

    const firstRunSaved = await historyStore.getRun(firstRunSummary!.runId);
    expect(firstRunSaved).toBeDefined();
    expect(firstRunSaved?.finalStatus).toBe("failed");

    // 2. Prepare resume
    const prep = await runtime.prepareResume(firstRunSummary!.runId, tmpDir);
    expect(prep.canResume).toBe(true);
    expect(prep.suggestedParentRunId).toBe(firstRunSummary!.runId);
    expect(prep.newRunId).not.toBe(firstRunSummary!.runId);

    // 3. Resume the task
    const resumeProvider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Successfully fixed tests." };
      }
    ]);

    const resumeRuntime = new AgentRuntime(resumeProvider, {
      historyStore
    });

    const secondRunEvents: AgentEvent[] = [];
    for await (const ev of resumeRuntime.run({
      message: prep.originalRun.userRequestSummary,
      cwd: tmpDir,
      parentRunId: prep.suggestedParentRunId
    })) {
      secondRunEvents.push(ev);
    }
    expect(secondRunEvents.length).toBeGreaterThan(0);

    const secondRunSummary = resumeRuntime.getLatestRunSummary();
    expect(secondRunSummary).toBeDefined();
    expect(secondRunSummary?.finalStatus).toBe("completed");

    // 4. Verify parent run remains immutable in history store
    const firstRunRechecked = await historyStore.getRun(firstRunSummary!.runId);
    expect(firstRunRechecked?.finalStatus).toBe("failed");

    // 5. Verify resumed run is saved with parent link
    const secondRunSaved = await historyStore.getRun(secondRunSummary!.runId);
    expect(secondRunSaved?.finalStatus).toBe("completed");
    expect(secondRunSaved?.parentRunId).toBe(firstRunSummary!.runId);
  });
});
