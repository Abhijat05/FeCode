import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan, transitionPlanStatus } from "./taskPlan.js";
import type { ModelProvider, ModelEvent } from "@fecode/models";

class MockProvider implements ModelProvider {
  public id = "mock-replan-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  async *generate(): AsyncIterable<ModelEvent> {
    yield { type: "text_delta", content: "I have inspected the code." };
  }
}

describe("AgentRuntime Replanning Integration — Phase 5R", () => {
  let tmpDir: string;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-runtime-replan-"));
    await fs.writeFile(
      path.join(tmpDir, "Index.ts"),
      "export const app = 'test';\n",
      "utf-8"
    );

    runtime = new AgentRuntime(new MockProvider(), {
      historyStorageDir: path.join(tmpDir, "history"),
      maxReplanDepth: 3
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prepares a replan from an active superseded plan and executes it cleanly", async () => {
    let oldPlan = createTaskPlan({
      planId: "plan-active-1",
      runId: "run-active-1",
      userRequestSummary: "Refactor Index.ts",
      objective: "Refactor Index.ts",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect Index.ts",
          objective: "Inspect file",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Modify Index.ts",
          objective: "Apply edit",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "failed",
          error: "Index.ts modified by another process"
        }
      ],
      status: "failed"
    });

    oldPlan = transitionPlanStatus(oldPlan, "superseded", "Workspace drifted");
    runtime.getReplanManager().registerPlan(oldPlan);

    const assessment = await runtime.prepareReplan("plan-active-1", {
      cwd: tmpDir,
      reason: "stale_workspace",
      explanation: "Index.ts modified externally"
    });

    expect(assessment.eligible).toBe(true);
    expect(assessment.previousPlanId).toBe("plan-active-1");
    expect(assessment.requiresUserConfirmation).toBe(true);

    const replanResult = await runtime.executeReplan({
      runId: "run-replan-exec-1",
      previousPlanId: "plan-active-1",
      reason: "stale_workspace",
      explanation: "Index.ts modified externally",
      cwd: tmpDir,
      userRequest: "Refactor Index.ts",
      requestedBy: "user"
    });

    expect(replanResult.status).toBe("created");
    expect(replanResult.newPlanId).toBeDefined();
    expect(replanResult.newPlan).toBeDefined();

    const currentPlan = runtime.getTaskPlan();
    expect(currentPlan).toBeDefined();
    expect(currentPlan?.planId).toBe(replanResult.newPlanId);
    expect(currentPlan?.status).toBe("ready"); // Ready for user approval
    expect(currentPlan?.parentPlanId).toBe("plan-active-1");
    expect(currentPlan?.replanDepth).toBe(1);
  });

  it("retrieves complete plan history across replan lineage chain", async () => {
    const replanMgr = runtime.getReplanManager();

    const plan1 = createTaskPlan({
      planId: "plan-h-1",
      runId: "run-h-1",
      userRequestSummary: "Initial task",
      objective: "Objective",
      steps: [],
      status: "superseded"
    });

    const plan2 = createTaskPlan({
      planId: "plan-h-2",
      runId: "run-h-2",
      parentPlanId: "plan-h-1",
      userRequestSummary: "Replan 1",
      objective: "Objective",
      steps: [],
      replanDepth: 1,
      status: "superseded"
    });

    const plan3 = createTaskPlan({
      planId: "plan-h-3",
      runId: "run-h-3",
      parentPlanId: "plan-h-2",
      userRequestSummary: "Replan 2",
      objective: "Objective",
      steps: [],
      replanDepth: 2,
      status: "ready"
    });

    replanMgr.registerPlan(plan1);
    replanMgr.registerPlan(plan2);
    replanMgr.registerPlan(plan3);

    const history = await replanMgr.getPlanHistory("plan-h-3");
    expect(history.length).toBe(3);
    expect(history[0].planId).toBe("plan-h-3");
    expect(history[1].planId).toBe("plan-h-2");
    expect(history[2].planId).toBe("plan-h-1");
  });
});
