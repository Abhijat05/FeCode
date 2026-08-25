import { describe, it, expect, beforeEach } from "vitest";
import { DefaultExecutionDecisionManager } from "./decisionManager.js";
import { createTaskPlan, blockPlan } from "./taskPlan.js";

describe("DefaultExecutionDecisionManager — Phase 5T", () => {
  let manager: DefaultExecutionDecisionManager;

  beforeEach(() => {
    manager = new DefaultExecutionDecisionManager();
  });

  it("creates an immutable decision request with deterministic defaults", () => {
    const request = manager.createDecisionRequest({
      runId: "run-1",
      planId: "plan-1",
      blockedStepId: "step-2",
      affectedStepIds: ["step-2", "step-3"],
      reason: "Verification failed on step-2"
    });

    expect(request.decisionId).toBeDefined();
    expect(request.runId).toBe("run-1");
    expect(request.planId).toBe("plan-1");
    expect(request.blockedStepId).toBe("step-2");
    expect(request.affectedStepIds).toEqual(["step-2", "step-3"]);
    expect(request.reason).toBe("Verification failed on step-2");
    expect(request.allowedDecisions).toEqual(["continue", "replan", "cancel"]);
    expect(request.defaultDecision).toBe("cancel");
    expect(request.requestedAt).toBeGreaterThan(0);

    const active = manager.getActiveRequest("plan-1");
    expect(active).toEqual(request);
  });

  it("resolves 'continue' decision and identifies the first incomplete step", async () => {
    let plan = createTaskPlan({
      planId: "plan-continue-1",
      runId: "run-continue-1",
      userRequestSummary: "Test plan",
      objective: "Test continue",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Step 1",
          objective: "Step 1",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Step 2",
          objective: "Step 2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: true,
          status: "failed",
          error: "Verification failed"
        },
        {
          stepId: "step-3",
          order: 3,
          title: "Step 3",
          objective: "Step 3",
          type: "verify",
          dependencies: ["step-2"],
          riskLevel: "low",
          verificationRequired: false,
          status: "skipped"
        }
      ]
    });
    plan = blockPlan(plan, "Verification failed on step-2");

    const req = manager.createDecisionRequest({
      runId: "run-continue-1",
      planId: "plan-continue-1",
      blockedStepId: "step-2",
      affectedStepIds: ["step-2", "step-3"],
      reason: "Verification failed on step-2"
    });

    const result = await manager.resolveDecision(req, "continue", { plan });

    expect(result.accepted).toBe(true);
    expect(result.decision).toBe("continue");
    expect(result.resultingPlanId).toBe("plan-continue-1");
    expect(result.resumedStepId).toBe("step-2");
    expect(result.resumedStepOrder).toBe(2);
    expect(result.cancelled).toBe(false);
  });

  it("resolves 'replan' decision successfully and clears active request", async () => {
    const req = manager.createDecisionRequest({
      runId: "run-replan-1",
      planId: "plan-replan-1",
      blockedStepId: "step-1",
      affectedStepIds: ["step-1"],
      reason: "Workspace drift"
    });

    const result = await manager.resolveDecision(req, "replan");

    expect(result.accepted).toBe(true);
    expect(result.decision).toBe("replan");
    expect(result.cancelled).toBe(false);

    // Active request cleared
    expect(manager.getActiveRequest("plan-replan-1")).toBeUndefined();
  });

  it("resolves 'cancel' decision cleanly", async () => {
    const req = manager.createDecisionRequest({
      runId: "run-cancel-1",
      planId: "plan-cancel-1",
      blockedStepId: "step-1",
      affectedStepIds: ["step-1"],
      reason: "User cancelled"
    });

    const result = await manager.resolveDecision(req, "cancel");

    expect(result.accepted).toBe(true);
    expect(result.decision).toBe("cancel");
    expect(result.cancelled).toBe(true);
  });

  it("defaults invalid user input to cancel decision", async () => {
    const req = manager.createDecisionRequest({
      runId: "run-invalid-1",
      planId: "plan-invalid-1",
      blockedStepId: "step-1",
      affectedStepIds: ["step-1"],
      reason: "Blocked"
    });

    // Submitting unknown or empty string defaults to defaultDecision ("cancel")
    const result = await manager.resolveDecision(req, "invalid_choice");

    expect(result.accepted).toBe(true);
    expect(result.decision).toBe("cancel");
    expect(result.cancelled).toBe(true);
  });

  it("prevents double resolution and handles race conditions atomically", async () => {
    const req = manager.createDecisionRequest({
      runId: "run-race-1",
      planId: "plan-race-1",
      blockedStepId: "step-1",
      affectedStepIds: ["step-1"],
      reason: "Blocked"
    });

    // First resolution wins
    const first = await manager.resolveDecision(req.decisionId, "continue");
    expect(first.accepted).toBe(true);

    // Second resolution attempt loses
    const second = await manager.resolveDecision(req.decisionId, "cancel");
    expect(second.accepted).toBe(false);
    expect(second.reason).toContain("already resolved");
  });
});
