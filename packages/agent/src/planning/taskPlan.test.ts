import { describe, it, expect } from "vitest";
import {
  createTaskPlan,
  transitionPlanStatus,
  canExecuteStep,
  startPlanStep,
  completePlanStep,
  failPlanStep,
  invalidatePlan,
  summarizePlan
} from "./taskPlan.js";
import type { PlanStep } from "./types.js";

describe("Task Plan Contracts & Lifecycle — Phase 5P", () => {
  function createSampleSteps(): PlanStep[] {
    return [
      {
        stepId: "step-1",
        order: 1,
        title: "Inspect codebase",
        objective: "Find target files",
        type: "inspect",
        dependencies: [],
        riskLevel: "low",
        verificationRequired: false,
        status: "pending"
      },
      {
        stepId: "step-2",
        order: 2,
        title: "Modify component",
        objective: "Update Button component",
        type: "modify",
        dependencies: ["step-1"],
        expectedFiles: ["src/Button.tsx"],
        riskLevel: "normal",
        verificationRequired: true,
        status: "pending",
        intent: {
          type: "modify_file",
          target: "src/Button.tsx",
          reason: "Apply styling fix",
          requiresApproval: true,
          estimatedRisk: "normal"
        }
      },
      {
        stepId: "step-3",
        order: 3,
        title: "Run tests",
        objective: "Verify no regressions",
        type: "test",
        dependencies: ["step-2"],
        riskLevel: "low",
        verificationRequired: true,
        status: "pending"
      }
    ];
  }

  it("creates a valid TaskPlan with ordered steps and default ready status", () => {
    const plan = createTaskPlan({
      runId: "run-101",
      userRequestSummary: "Fix Button component",
      objective: "Fix Button component styling",
      steps: createSampleSteps(),
      verificationStrategy: ["typecheck", "test"]
    });

    expect(plan.planId).toBeDefined();
    expect(plan.runId).toBe("run-101");
    expect(plan.status).toBe("ready");
    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].order).toBe(1);
    expect(plan.steps[1].dependencies).toEqual(["step-1"]);
    expect(plan.verificationStrategy).toEqual(["typecheck", "test"]);
  });

  describe("Lifecycle Transitions", () => {
    it("allows valid transitions through the full lifecycle (draft -> ready -> approved -> executing -> completed)", () => {
      let plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Fix Button component",
        objective: "Fix Button component",
        steps: createSampleSteps(),
        status: "draft"
      });

      expect(plan.status).toBe("draft");

      plan = transitionPlanStatus(plan, "ready");
      expect(plan.status).toBe("ready");

      plan = transitionPlanStatus(plan, "approved");
      expect(plan.status).toBe("approved");

      plan = transitionPlanStatus(plan, "executing");
      expect(plan.status).toBe("executing");

      plan = transitionPlanStatus(plan, "completed");
      expect(plan.status).toBe("completed");
    });

    it("allows transitioning from executing to failed or cancelled", () => {
      const plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "executing"
      });

      const failedPlan = transitionPlanStatus(plan, "failed");
      expect(failedPlan.status).toBe("failed");

      const cancelledPlan = transitionPlanStatus(plan, "cancelled");
      expect(cancelledPlan.status).toBe("cancelled");
    });

    it("allows transitioning active plans to superseded upon invalidation", () => {
      const plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "ready"
      });

      const superseded = invalidatePlan(plan, "Workspace drift detected");
      expect(superseded.status).toBe("superseded");
      expect(superseded.invalidationReason).toBe("Workspace drift detected");
    });

    it("rejects invalid status transitions", () => {
      const plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "completed"
      });

      expect(() => transitionPlanStatus(plan, "executing")).toThrow(
        /Invalid plan status transition/
      );
      expect(() => transitionPlanStatus(plan, "ready")).toThrow(
        /Invalid plan status transition/
      );
    });
  });

  describe("Step Dependency Enforcement", () => {
    it("permits executing step-1 without dependencies", () => {
      const plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "approved"
      });

      const check1 = canExecuteStep(plan, "step-1");
      expect(check1.canExecute).toBe(true);

      const check2 = canExecuteStep(plan, "step-2");
      expect(check2.canExecute).toBe(false);
      expect(check2.reason).toContain("step-1 has not completed");
    });

    it("allows step-2 to execute only after step-1 is completed", () => {
      let plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "approved"
      });

      plan = startPlanStep(plan, "step-1");
      expect(plan.steps[0].status).toBe("in_progress");
      expect(plan.status).toBe("executing");

      plan = completePlanStep(plan, "step-1");
      expect(plan.steps[0].status).toBe("completed");

      const check2 = canExecuteStep(plan, "step-2");
      expect(check2.canExecute).toBe(true);

      plan = startPlanStep(plan, "step-2");
      expect(plan.steps[1].status).toBe("in_progress");

      plan = completePlanStep(plan, "step-2");
      expect(plan.steps[1].status).toBe("completed");

      plan = startPlanStep(plan, "step-3");
      plan = completePlanStep(plan, "step-3");
      expect(plan.steps[2].status).toBe("completed");
      expect(plan.status).toBe("completed");
    });

    it("blocks and marks downstream steps as skipped when a prerequisite step fails", () => {
      let plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Task",
        steps: createSampleSteps(),
        status: "approved"
      });

      plan = startPlanStep(plan, "step-1");
      plan = completePlanStep(plan, "step-1");

      plan = startPlanStep(plan, "step-2");
      plan = failPlanStep(plan, "step-2", "Syntax error in Button.tsx");

      expect(plan.status).toBe("failed");
      expect(plan.steps[1].status).toBe("failed");
      expect(plan.steps[1].error).toBe("Syntax error in Button.tsx");

      // step-3 depends on step-2, so it should be skipped
      expect(plan.steps[2].status).toBe("skipped");
      expect(plan.steps[2].error).toContain("Skipped because dependency step-2 failed");

      const check3 = canExecuteStep(plan, "step-3");
      expect(check3.canExecute).toBe(false);
      expect(check3.reason).toContain("step-3 is skipped");
    });
  });

  describe("Plan Summarization", () => {
    it("correctly calculates plan summary, highest risk, and approval requirements", () => {
      const plan = createTaskPlan({
        runId: "run-101",
        userRequestSummary: "Task",
        objective: "Fix Button component",
        steps: createSampleSteps(),
        status: "ready"
      });

      const summary = summarizePlan(plan);
      expect(summary.totalSteps).toBe(3);
      expect(summary.completedSteps).toBe(0);
      expect(summary.highestRisk).toBe("normal");
      expect(summary.requiresApproval).toBe(true);
    });
  });
});
