import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../runtime.js";
import type { CheckpointManager, CheckpointResult } from "../checkpoints/types.js";
import type {
  ApprovalResolver,
  ModelProvider,
  Tool,
  ToolExecutor
} from "@fecode/models";
import { DefaultToolRegistry } from "@fecode/models";
import type { ExecutionPolicy } from "../policy/types.js";

function createMockProvider(turnChunks: unknown[][]): ModelProvider {
  let turn = 0;
  return {
    name: "mock",
    model: "mock-model",
    supportsTools: true,
    capabilities: {
      maxContextTokens: 32768,
      supportsTools: true,
      supportsStreaming: true
    },
    async *generate() {
      const chunks = turnChunks[turn] || [];
      turn++;
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  } as unknown as ModelProvider;
}

describe("Section 4.2.12 — Interrupted Processes & Partial Mutation Rollback", () => {
  it("cancel({ rollback: true }) triggers checkpoint restore when checkpoint exists", async () => {
    const restoreSpy = vi.fn().mockResolvedValue({
      success: true,
      checkpointId: "cp-123",
      restoredFiles: ["src/index.ts"]
    });

    const mockCheckpointManager: Partial<CheckpointManager> = {
      restore: restoreSpy
    };

    const runtime = new AgentRuntime(createMockProvider([]), {
      checkpointManager: mockCheckpointManager as CheckpointManager
    });

    // Simulate a run where a checkpoint was recorded and a file was modified
    (runtime as unknown as { completionTracker: { setCheckpointId: (id: string) => void; recordFileModified: (path: string) => void } })
      .completionTracker.setCheckpointId("cp-123");
    (runtime as unknown as { completionTracker: { recordFileModified: (path: string) => void } })
      .completionTracker.recordFileModified("src/index.ts");

    await runtime.cancel({ rollback: true });

    expect(restoreSpy).toHaveBeenCalledWith("cp-123", {
      cwd: expect.any(String),
      approved: true
    });
    expect(runtime.getCompletionSummary().status).toBe("cancelled");
  });

  it("rollbackLastMutation() invokes checkpoint restore on pre-task checkpoint", async () => {
    const restoreSpy = vi.fn().mockResolvedValue({
      success: true,
      checkpointId: "cp-abc",
      restoredFiles: ["src/app.ts"]
    });

    const mockCheckpointManager: Partial<CheckpointManager> = {
      restore: restoreSpy
    };

    const runtime = new AgentRuntime(createMockProvider([]), {
      checkpointManager: mockCheckpointManager as CheckpointManager
    });

    (runtime as unknown as { completionTracker: { setCheckpointId: (id: string) => void } })
      .completionTracker.setCheckpointId("cp-abc");

    const result = await runtime.rollbackLastMutation("/test/repo");

    expect(restoreSpy).toHaveBeenCalledWith("cp-abc", {
      cwd: "/test/repo",
      approved: true
    });
    expect(result?.success).toBe(true);
  });

  it("emits partial_mutation_cancelled and performs auto-rollback when autoRollbackOnCancel is true", async () => {
    const restoreSpy = vi.fn().mockResolvedValue({
      success: true,
      checkpointId: "cp-789",
      restoredFiles: ["packages/agent/src/foo.ts"]
    });

    const mockCheckpointManager: Partial<CheckpointManager> = {
      create: vi.fn().mockResolvedValue({
        success: true,
        checkpoint: { id: "cp-789", totalFiles: 1 }
      } as CheckpointResult),
      restore: restoreSpy
    };

    const mockExecutor: ToolExecutor = {
      async execute() {
        return {
          success: true,
          output: { path: "packages/agent/src/foo.ts", diff: "+new line\n", changed: true }
        };
      }
    };

    const mockApprovalResolver: ApprovalResolver = {
      resolve: async () => ({ approved: true })
    };

    // Turn 0: tool call that mutates file. Turn 1: user aborts.
    const provider = createMockProvider([
      [
        {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "write_file",
            arguments: { path: "packages/agent/src/foo.ts", content: "data" }
          }
        }
      ],
      [
        {
          type: "error",
          error: new Error("AbortError: Operation cancelled by user")
        }
      ]
    ]);

    const mockExecutionPolicy = {
      assess: () => ({
        level: "elevated" as const,
        requiresCheckpoint: true,
        reasons: ["Elevated risk"],
        requiresExplicitApproval: false
      })
    };

    const registry = new DefaultToolRegistry();
    registry.register({
      name: "write_file",
      description: "write file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      execute: async () => ({
        success: true,
        output: { path: "packages/agent/src/foo.ts", diff: "+new line\n", changed: true }
      })
    } as unknown as Tool);

    const runtime = new AgentRuntime(provider, {
      registry,
      checkpointManager: mockCheckpointManager as CheckpointManager,
      executor: mockExecutor,
      approvalResolver: mockApprovalResolver,
      executionPolicy: mockExecutionPolicy as unknown as ExecutionPolicy
    });

    const events = [];
    for await (const event of runtime.run({
      message: "Modify foo.ts file",
      cwd: "/test/project",
      autoRollbackOnCancel: true
    })) {
      events.push(event);
    }

    const cancelNotice = events.find((e) => e.type === "partial_mutation_cancelled");
    expect(cancelNotice).toBeDefined();
    if (cancelNotice && cancelNotice.type === "partial_mutation_cancelled") {
      expect(cancelNotice.reverted).toBe(true);
      expect(cancelNotice.checkpointId).toBe("cp-789");
      expect(cancelNotice.modifiedFiles).toContain("packages/agent/src/foo.ts");
    }

    expect(restoreSpy).toHaveBeenCalledWith("cp-789", {
      cwd: "/test/project",
      approved: true
    });
  });

  it("emits partial_mutation_cancelled with reverted=false and checkpoint instructions when not auto-rolled back", async () => {
    const mockCheckpointManager: Partial<CheckpointManager> = {
      create: vi.fn().mockResolvedValue({
        success: true,
        checkpoint: { id: "cp-manual", totalFiles: 1 }
      } as CheckpointResult),
      restore: vi.fn()
    };

    const mockExecutor: ToolExecutor = {
      async execute() {
        return {
          success: true,
          output: { path: "src/file1.ts", diff: "+line\n", changed: true }
        };
      }
    };

    const mockApprovalResolver: ApprovalResolver = {
      resolve: async () => ({ approved: true })
    };

    const provider = createMockProvider([
      [
        {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "write_file",
            arguments: { path: "src/file1.ts", content: "data" }
          }
        }
      ],
      [
        {
          type: "error",
          error: new Error("User abort signal received")
        }
      ]
    ]);

    const mockExecutionPolicy = {
      assess: () => ({
        level: "elevated" as const,
        requiresCheckpoint: true,
        reasons: ["Elevated risk"],
        requiresExplicitApproval: false
      })
    };

    const registry = new DefaultToolRegistry();
    registry.register({
      name: "write_file",
      description: "write file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      permissionCategory: "write",
      execute: async () => ({
        success: true,
        output: { path: "src/file1.ts", diff: "+line\n", changed: true }
      })
    } as unknown as Tool);

    const runtime = new AgentRuntime(provider, {
      registry,
      checkpointManager: mockCheckpointManager as CheckpointManager,
      executor: mockExecutor,
      approvalResolver: mockApprovalResolver,
      executionPolicy: mockExecutionPolicy as unknown as ExecutionPolicy
    });

    const events = [];
    for await (const event of runtime.run({
      message: "Multi-file update",
      cwd: "/test/project",
      autoRollbackOnCancel: false
    })) {
      events.push(event);
    }

    const cancelNotice = events.find(
      (e) => e.type === "partial_mutation_cancelled"
    );
    expect(cancelNotice).toBeDefined();
    if (cancelNotice && cancelNotice.type === "partial_mutation_cancelled") {
      expect(cancelNotice.reverted).toBe(false);
      expect(cancelNotice.checkpointId).toBe("cp-manual");
      expect(cancelNotice.message).toContain("/restore cp-manual");
    }
  });
});
