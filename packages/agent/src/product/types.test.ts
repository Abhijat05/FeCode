import { describe, it, expect } from "vitest";
import type { UIState, UIStatus, UIApprovalModel, PlanSnapshot } from "./types.js";

describe("Phase 5AC — Product Types & State Models", () => {
  it("constructs valid UIState structure", () => {
    const state: UIState = {
      status: "idle",
      lifecycleState: "idle",
      sessionId: "session-1",
      cwd: process.cwd(),
      timeline: [],
      messages: [],
      skills: ["git", "testing"],
      riskLevel: "low"
    };

    expect(state.status).toBe("idle");
    expect(state.lifecycleState).toBe("idle");
    expect(state.skills).toContain("git");
    expect(state.riskLevel).toBe("low");
  });

  it("supports comprehensive UI statuses covering derived approval states", () => {
    const statuses: UIStatus[] = [
      "idle",
      "planning",
      "awaiting_plan_approval",
      "executing",
      "awaiting_step_approval",
      "verifying",
      "blocked",
      "recovering",
      "awaiting_recovery_decision",
      "awaiting_continuation",
      "awaiting_replan",
      "completed",
      "failed",
      "cancelled"
    ];

    expect(statuses.length).toBe(14);
  });

  it("defines strict separation for UIApprovalModel types", () => {
    const planApproval: UIApprovalModel = {
      approvalId: "app-1",
      type: "plan",
      runId: "run-1",
      planId: "plan-1",
      riskLevel: "elevated",
      reason: "Plan approval needed",
      affectedTargets: ["src/index.ts"],
      defaultDecision: "reject"
    };

    const stepCheckpointApproval: UIApprovalModel = {
      approvalId: "app-2",
      type: "step_checkpoint",
      runId: "run-1",
      planId: "plan-1",
      stepId: "step-1",
      checkpointId: "cp-1",
      riskLevel: "elevated",
      reason: "Checkpoint approval needed",
      affectedTargets: ["src/index.ts"],
      defaultDecision: "reject"
    };

    expect(planApproval.type).not.toBe(stepCheckpointApproval.type);
    expect(planApproval.defaultDecision).toBe("reject");
    expect(stepCheckpointApproval.defaultDecision).toBe("reject");
  });

  it("represents plan snapshots accurately", () => {
    const plan: PlanSnapshot = {
      planId: "plan-10",
      runId: "run-10",
      objective: "Build feature",
      userRequestSummary: "Feature request",
      status: "approved",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect files",
          objective: "Inspect",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          status: "completed",
          verificationRequired: false
        }
      ],
      createdAt: Date.now(),
      completedStepsCount: 1,
      totalStepsCount: 1
    };

    expect(plan.completedStepsCount).toBe(1);
    expect(plan.steps[0].status).toBe("completed");
  });
});
