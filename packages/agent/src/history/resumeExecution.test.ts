import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { DefaultRunHistoryStore } from "./runHistoryStore.js";
import { DefaultToolRegistry } from "@fecode/models";
import { getProjectIdentifier } from "./projectIdentifier.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelEvent,
  ApprovalResolver,
  ApprovalDecision
} from "@fecode/models";
import type { AgentEvent } from "../index.js";
import type { DurableRunRecord } from "./types.js";

class MockProvider implements ModelProvider {
  public id = "mock-resume-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  private readonly responses: Array<(req: ModelRequest) => AsyncIterable<ModelEvent>>;
  public recordedRequests: ModelRequest[] = [];

  constructor(responses: Array<(req: ModelRequest) => AsyncIterable<ModelEvent>>) {
    this.responses = [...responses];
  }

  async *generate(req: ModelRequest): AsyncIterable<ModelEvent> {
    this.recordedRequests.push(req);
    const fn = this.responses.shift();
    if (!fn) {
      yield { type: "text_delta", content: "Done." };
      return;
    }
    yield* fn(req);
  }
}

describe("Explicit Resume Execution & Workspace Reconciliation — Phase 5O", () => {
  let tmpDir: string;
  let projectId: string;
  let historyDir: string;
  let historyStore: DefaultRunHistoryStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-resume-exec-"));
    projectId = await getProjectIdentifier(tmpDir);
    historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-history-store-"));
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

  it("successfully executes an explicitly approved resume as a NEW run without mutating parent", async () => {
    // 1. Save a failed run
    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-parent-failed",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Refactor core authentication",
      startedAt: Date.now() - 60000,
      completedAt: Date.now() - 55000,
      durationMs: 5000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: ["typescript"],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 3,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [{ toolName: "edit_file", callId: "c1", startedAt: Date.now() }],
      commands: [{ command: "npm test", attempt: 1, startedAt: Date.now(), succeeded: false }],
      files: { modified: ["index.ts"], created: [], deleted: [] },
      lifecycleTransitions: [],
      failureReason: "Verification failed after 3 attempts"
    };

    await historyStore.saveRun(failedRun);

    // Mock provider for the resumed run
    const provider = new MockProvider([
      async function* () {
        yield { type: "text_delta", content: "Successfully completed resumed task." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      historyStore
    });

    // 2. Execute approved resume
    const events: AgentEvent[] = [];
    for await (const ev of runtime.resumeRun("run-parent-failed", {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    const latestSummary = runtime.getLatestRunSummary();
    expect(latestSummary).toBeDefined();
    expect(latestSummary?.finalStatus).toBe("completed");
    expect(latestSummary?.parentRunId).toBe("run-parent-failed");
    expect(latestSummary?.runId).not.toBe("run-parent-failed");

    // 3. Parent run in history remains failed and unmodified
    const parentInStore = await historyStore.getRun("run-parent-failed");
    expect(parentInStore).toBeDefined();
    expect(parentInStore?.finalStatus).toBe("failed");
    expect(parentInStore?.failureReason).toBe("Verification failed after 3 attempts");

    // 4. Lineage verification
    const lineage = await runtime.getRunLineage(latestSummary!.runId);
    expect(lineage.length).toBe(2);
    expect(lineage[0].runId).toBe(latestSummary!.runId);
    expect(lineage[1].runId).toBe("run-parent-failed");
  });

  it("rejects resume when explicit approval is missing", async () => {
    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-no-approval",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Test approval check",
      startedAt: Date.now() - 10000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(failedRun);

    const provider = new MockProvider([]);
    const runtime = new AgentRuntime(provider, { historyStore });

    let errorThrown: Error | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of runtime.resumeRun("run-no-approval", {
        cwd: tmpDir,
        approved: false // Explicitly not approved
      })) {
        // stream
      }
    } catch (err: unknown) {
      errorThrown = err as Error;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown?.message).toContain("Explicit user approval is required");
  });

  it("rejects resume when project identity mismatches", async () => {
    const foreignProjectRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-foreign-proj",
      projectId: "other-project-hash-123456",
      cwd: "/other/workspace",
      userRequestSummary: "Other project task",
      startedAt: Date.now() - 10000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(foreignProjectRun);

    const provider = new MockProvider([]);
    const runtime = new AgentRuntime(provider, { historyStore });

    let errorThrown: Error | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of runtime.resumeRun("run-foreign-proj", {
        cwd: tmpDir,
        approved: true
      })) {
        // stream
      }
    } catch (err: unknown) {
      errorThrown = err as Error;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown?.message).toContain("Project mismatch");
  });

  it("handles cancellation during resumed execution without corrupting parent run", async () => {
    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-to-cancel-parent",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Task to cancel",
      startedAt: Date.now() - 10000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(failedRun);

    const runtimeContainer: { runtime?: AgentRuntime } = {};
    const provider = new MockProvider([
      async function* () {
        // Cancel mid-stream
        if (runtimeContainer.runtime) {
          await runtimeContainer.runtime.cancel();
        }
        yield { type: "text_delta", content: "Working..." };
      }
    ]);

    const runtime = new AgentRuntime(provider, { historyStore });
    runtimeContainer.runtime = runtime;

    const events: AgentEvent[] = [];
    for await (const ev of runtime.resumeRun("run-to-cancel-parent", {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const latest = runtime.getLatestRunSummary();
    expect(latest?.finalStatus).toBe("cancelled");
    expect(latest?.parentRunId).toBe("run-to-cancel-parent");

    // Parent run remains failed
    const parent = await historyStore.getRun("run-to-cancel-parent");
    expect(parent?.finalStatus).toBe("failed");
  });

  it("does NOT replay previous tool calls or commands automatically", async () => {
    let executedCommandCount = 0;
    const registry = new DefaultToolRegistry();
    registry.register({
      name: "execute_command",
      description: "Exec",
      permissionCategory: "execute",
      inputSchema: { type: "object" },
      execute: async () => {
        executedCommandCount++;
        return { success: true, output: "Command executed" };
      }
    });

    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-no-replay",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Fix bugs",
      startedAt: Date.now() - 10000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [{ toolName: "execute_command", callId: "c-old", startedAt: Date.now() }],
      commands: [{ command: "npm test", attempt: 1, startedAt: Date.now(), succeeded: false }],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(failedRun);

    const provider = new MockProvider([
      async function* () {
        // Model only replies with text without calling any tools
        yield { type: "text_delta", content: "Reviewing code." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      registry,
      historyStore
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.resumeRun("run-no-replay", {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    // Zero commands were replayed
    expect(executedCommandCount).toBe(0);
  });

  it("revalidates permissions fresh and does not inherit old approvals", async () => {
    let approvalRequestedCount = 0;
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => {
        approvalRequestedCount++;
        return { approved: true };
      }
    };

    const registry = new DefaultToolRegistry();
    registry.register({
      name: "write_file",
      description: "Write",
      permissionCategory: "write",
      inputSchema: { type: "object" },
      execute: async () => ({ success: true, output: "File written" })
    });

    const failedRun: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-old-approval",
      projectId,
      cwd: tmpDir,
      userRequestSummary: "Write a file",
      startedAt: Date.now() - 10000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [{ toolName: "write_file", callId: "c-prev", startedAt: Date.now() }],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await historyStore.saveRun(failedRun);

    const provider = new MockProvider([
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-fresh-write",
            name: "write_file",
            arguments: { path: "new.ts", content: "export const n = 2;" }
          }
        };
      },
      async function* () {
        yield { type: "text_delta", content: "Finished write." };
      }
    ]);

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: resolver,
      historyStore
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.resumeRun("run-old-approval", {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    // Fresh approval was requested
    expect(approvalRequestedCount).toBe(1);
  });
});
