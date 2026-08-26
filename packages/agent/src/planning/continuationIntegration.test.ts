import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan } from "./taskPlan.js";
import type { AgentEvent } from "../index.js";
import type { ModelProvider } from "@fecode/models";

describe("Phase 5X — Recovery Continuation Runtime Integration & Safety", () => {
  let tmpDir: string;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5x-runtime-"));
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
      // Ignore
    }
  });

  it("coordinates recovery continuation via AgentRuntime and updates diagnostics", async () => {
    const targetFile = "src/integ_step.ts";
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, targetFile), "export const step = 1;\n");

    const plan = createTaskPlan({
      planId: "plan-5x-rt-1",
      runId: "run-5x-rt-1",
      userRequestSummary: "Runtime continuation test",
      objective: "Integration",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1",
          objective: "Step 1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: [targetFile]
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: [targetFile]
        }
      ]
    });

    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const prep = await runtime.prepareRecoveryContinuation({
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    expect(prep.canContinue).toBe(true);
    expect(prep.remainingSteps.length).toBe(1);

    const events: AgentEvent[] = [];
    for await (const ev of runtime.continueRecoveredPlan(prep, {
      runId: plan.runId,
      planId: plan.planId,
      decision: "continue",
      approved: true,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const startEv = events.find(
      (e) => e.type === "recovery_continuation_started"
    );
    expect(startEv).toBeDefined();

    // Check diagnostics recording
    const summary = runtime.getDiagnosticsManager().getRunSummary(plan.runId);
    expect(summary?.continuationCount).toBeGreaterThanOrEqual(1);
    expect(summary?.lastContinuationDecision).toBe("continue");
  });

  it("handles cancellation during runtime continuation", async () => {
    const plan = createTaskPlan({
      planId: "plan-5x-rt-2",
      runId: "run-5x-rt-2",
      userRequestSummary: "Cancel runtime test",
      objective: "Cancel",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1",
          objective: "Step 1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending"
        }
      ]
    });

    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const prep = await runtime.prepareRecoveryContinuation({
      cwd: tmpDir,
      recoveryOutcome: "recovered"
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.continueRecoveredPlan(prep, {
      runId: plan.runId,
      planId: plan.planId,
      decision: "cancel",
      approved: false,
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    const cancelEv = events.find(
      (e) => e.type === "recovery_continuation_cancelled"
    );
    expect(cancelEv).toBeDefined();

    const summary = runtime.getDiagnosticsManager().getRunSummary(plan.runId);
    expect(summary?.lastContinuationStatus).toBe("cancelled");
  });
});
