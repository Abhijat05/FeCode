import { describe, it, expect, beforeEach } from "vitest";
import { DefaultExecutionFeedbackManager } from "./executionFeedback.js";
import { createTaskPlan } from "./taskPlan.js";

describe("DefaultExecutionFeedbackManager — Phase 5S", () => {
  let manager: DefaultExecutionFeedbackManager;

  beforeEach(() => {
    manager = new DefaultExecutionFeedbackManager();
  });

  describe("Feedback Recording & Retrieval", () => {
    it("records info feedback for completed steps and associates with run/plan", () => {
      const feedback = manager.recordFeedback({
        runId: "run-1",
        planId: "plan-1",
        stepId: "step-1",
        kind: "step_completed",
        summary: "Step 1 completed successfully"
      });

      expect(feedback.feedbackId).toBeDefined();
      expect(feedback.severity).toBe("info");
      expect(feedback.recommendedAction).toBe("continue");
      expect(feedback.requiresReplanning).toBe(false);
      expect(feedback.requiresUserConfirmation).toBe(false);

      const runFeedbacks = manager.getFeedback("run-1");
      expect(runFeedbacks.length).toBe(1);
      expect(runFeedbacks[0].stepId).toBe("step-1");
    });

    it("records blocking feedback for workspace drift and flags requiresReplanning", () => {
      const feedback = manager.recordFeedback({
        runId: "run-1",
        planId: "plan-1",
        kind: "workspace_drift",
        summary: "Workspace drifted: 2 files changed externally"
      });

      expect(feedback.severity).toBe("blocking");
      expect(feedback.requiresReplanning).toBe(true);
      expect(feedback.requiresUserConfirmation).toBe(true);
      expect(feedback.recommendedAction).toBe("replan");
    });

    it("records warning feedback for retryable verification failures", () => {
      const feedback = manager.recordFeedback({
        runId: "run-1",
        planId: "plan-1",
        stepId: "step-2",
        kind: "verification_failed",
        summary: "Verification failed (exit code 1)"
      });

      expect(feedback.severity).toBe("warning");
      expect(feedback.recommendedAction).toBe("retry");
      expect(feedback.requiresReplanning).toBe(false);
    });
  });

  describe("Plan Adaptation Assessment", () => {
    it("assesses healthy plan with no failures as canContinue=true", () => {
      const plan = createTaskPlan({
        planId: "plan-ok",
        runId: "run-ok",
        userRequestSummary: "Inspect component",
        objective: "Inspect",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect",
            objective: "Read",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "completed"
          }
        ]
      });

      manager.recordFeedback({
        runId: "run-ok",
        planId: "plan-ok",
        stepId: "step-1",
        kind: "step_completed",
        summary: "Step 1 done"
      });

      const assessment = manager.assessPlanAdaptation(plan);
      expect(assessment.canContinue).toBe(true);
      expect(assessment.canRetry).toBe(false);
      expect(assessment.canAdapt).toBe(false);
      expect(assessment.recommendedAction).toBe("continue");
      expect(assessment.requiresUserConfirmation).toBe(false);
    });

    it("cascades failure to all downstream dependent steps", () => {
      const plan = createTaskPlan({
        planId: "plan-dep",
        runId: "run-dep",
        userRequestSummary: "Complex task",
        objective: "Multi-step build",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Step 1",
            objective: "Obj",
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
            objective: "Obj",
            type: "modify",
            dependencies: ["step-1"],
            riskLevel: "normal",
            verificationRequired: true,
            status: "failed"
          },
          {
            stepId: "step-3",
            order: 3,
            title: "Step 3 (depends on 2)",
            objective: "Obj",
            type: "verify",
            dependencies: ["step-2"],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending"
          },
          {
            stepId: "step-4",
            order: 4,
            title: "Step 4 (depends on 3)",
            objective: "Obj",
            type: "configure",
            dependencies: ["step-3"],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending"
          }
        ]
      });

      manager.recordFeedback({
        runId: "run-dep",
        planId: "plan-dep",
        stepId: "step-2",
        kind: "step_failed",
        summary: "Syntax error in step 2"
      });

      const assessment = manager.assessPlanAdaptation(plan);
      expect(assessment.canContinue).toBe(false);
      expect(assessment.canAdapt).toBe(true);
      expect(assessment.recommendedAction).toBe("replan");
      expect(assessment.affectedSteps).toContain("step-2");
      expect(assessment.affectedSteps).toContain("step-3");
      expect(assessment.affectedSteps).toContain("step-4");
      expect(assessment.affectedSteps).not.toContain("step-1");
    });

    it("marks all remaining uncompleted steps affected when global workspace drift occurs", () => {
      const plan = createTaskPlan({
        planId: "plan-drift",
        runId: "run-drift",
        userRequestSummary: "Build feature",
        objective: "Build feature",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Step 1",
            objective: "Obj",
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
            objective: "Obj",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending"
          },
          {
            stepId: "step-3",
            order: 3,
            title: "Step 3",
            objective: "Obj",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending"
          }
        ]
      });

      manager.recordFeedback({
        runId: "run-drift",
        planId: "plan-drift",
        kind: "workspace_drift",
        summary: "Branch changed externally"
      });

      const assessment = manager.assessPlanAdaptation(plan);
      expect(assessment.canContinue).toBe(false);
      expect(assessment.recommendedAction).toBe("replan");
      expect(assessment.requiresUserConfirmation).toBe(true);
      expect(assessment.affectedSteps).toEqual(expect.arrayContaining(["step-2", "step-3"]));
      expect(assessment.affectedSteps).not.toContain("step-1");
    });
  });
});
