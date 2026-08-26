import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan } from "./taskPlan.js";
import type { AgentEvent } from "../index.js";
import type { FinalReconciliationResult } from "./types.js";
import type { ModelProvider } from "@fecode/models";

describe("Phase 5W — Recovery Outcome Runtime Integration & Safety", () => {
  let tmpDir: string;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5w-runtime-"));
    const mockModel: ModelProvider = {
      id: "mock",
      capabilities: {
        streaming: true,
        toolCalling: false,
        vision: false,
        maxContextTokens: 4096
      },
      async *generate() {
        yield { type: "text_delta", content: "OK" };
        yield {
          type: "completed",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
        };
      }
    };
    runtime = new AgentRuntime(mockModel);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  it("handles terminal outcome locking and emits recovery_outcome_determined before completed", async () => {
    const targetFile = "src/integ_out.ts";
    const plan = createTaskPlan({
      planId: "plan-5w-int-1",
      runId: "run-5w-int-1",
      userRequestSummary: "Test integration",
      objective: "Integration",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: `Create ${targetFile}`,
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: [targetFile],
          intent: {
            type: "create_file",
            target: targetFile,
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const reconResult: FinalReconciliationResult = {
      reconciliationId: "recon-int-1",
      runId: "run-5w-int-1",
      planId: "plan-5w-int-1",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: [targetFile],
      modifiedFiles: [],
      unexpectedFiles: [],
      missingFiles: [targetFile],
      changedFiles: [],
      branchChanged: false,
      workspaceChanged: false,
      verificationPassed: true,
      consistent: false,
      failureReason: `Missing expected files: ${targetFile}`
    };

    const assessment = await runtime.assessExecutionRecovery(undefined, {
      cwd: tmpDir,
      reconciliationResult: reconResult
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.executeExecutionRecovery(assessment, {
      cwd: tmpDir,
      approved: true
    })) {
      events.push(ev);
    }

    const outcomeIdx = events.findIndex(
      (e) => e.type === "recovery_outcome_determined"
    );
    const completedIdx = events.findIndex((e) => e.type === "recovery_completed");

    expect(outcomeIdx).toBeGreaterThan(-1);
    expect(completedIdx).toBeGreaterThan(-1);
    expect(outcomeIdx).toBeLessThan(completedIdx);

    const outcomeEv = events[outcomeIdx];
    if (outcomeEv.type === "recovery_outcome_determined") {
      expect(["recovered", "recovered_with_changes"]).toContain(outcomeEv.outcome);
      expect(outcomeEv.result.workspaceConsistent).toBe(true);
    }
  });

  it("handles cancellation during recovery execution cleanly", async () => {
    const plan = createTaskPlan({
      planId: "plan-5w-int-2",
      runId: "run-5w-int-2",
      userRequestSummary: "Test cancel integration",
      objective: "Integration",
      status: "blocked",
      steps: []
    });

    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const controller = new AbortController();
    controller.abort();

    const assessment = await runtime.assessExecutionRecovery(undefined, {
      cwd: tmpDir,
      strategy: "repair",
      reason: "Cancel test"
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.executeExecutionRecovery(assessment, {
      cwd: tmpDir,
      approved: true,
      signal: controller.signal
    })) {
      events.push(ev);
    }

    const cancelEv = events.find((e) => e.type === "recovery_cancelled");
    expect(cancelEv).toBeDefined();

    // Verify diagnostics recorded cancellation
    const summary = runtime.getDiagnosticsManager().getRunSummary("run-5w-int-2");
    expect(summary?.lastRecoveryStatus).toBe("cancelled");
  });
});
