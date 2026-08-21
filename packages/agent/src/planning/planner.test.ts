import { describe, it, expect } from "vitest";
import { DefaultTaskPlanner } from "./planner.js";

describe("DefaultTaskPlanner — Phase 5P", () => {
  const planner = new DefaultTaskPlanner();

  it("generates read-only execution plan for queries without mutations", () => {
    const plan = planner.createPlan({
      runId: "run-readonly-1",
      userMessage: "Explain how authentication middleware works in this repo",
      cwd: "/test",
      authoritativeRisk: "low"
    });

    expect(plan.planId).toBeDefined();
    expect(plan.status).toBe("ready");
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].type).toBe("inspect");
    expect(plan.steps[1].type).toBe("analyze");
    expect(plan.steps.every((s) => !s.intent?.requiresApproval)).toBe(true);
    expect(plan.risks.length).toBe(0);
    expect(plan.checkpoints?.length).toBe(0);
  });

  it("generates modifying execution plan with sequential dependencies and approval requirements", () => {
    const plan = planner.createPlan({
      runId: "run-modify-1",
      userMessage: "Refactor auth tokens to use HMAC signatures",
      cwd: "/test",
      authoritativeRisk: "elevated",
      affectedFiles: ["src/auth.ts"]
    });

    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].type).toBe("inspect");
    expect(plan.steps[1].type).toBe("modify");
    expect(plan.steps[1].dependencies).toEqual(["step-1"]);
    expect(plan.steps[1].riskLevel).toBe("elevated");
    expect(plan.steps[1].intent?.requiresApproval).toBe(true);
    expect(plan.steps[2].type).toBe("verify");
    expect(plan.steps[2].dependencies).toEqual(["step-2"]);

    // Checkpoint & risk recommendations for elevated risk
    expect(plan.risks.length).toBeGreaterThan(0);
    expect(plan.risks[0].level).toBe("elevated");
    expect(plan.checkpoints?.length).toBeGreaterThan(0);
    expect(plan.checkpoints![0].timing).toBe("before_mutation");
  });

  it("never lowers authoritative risk supplied by TaskRiskPolicy", () => {
    const plan = planner.createPlan({
      runId: "run-risk-check",
      userMessage: "Update config file",
      cwd: "/test",
      authoritativeRisk: "critical"
    });

    expect(plan.steps[1].riskLevel).toBe("critical");
    expect(plan.risks.some((r) => r.level === "critical")).toBe(true);
  });

  it("creates a fresh plan on replan with incremented replanCount and invalidationReason", () => {
    const oldPlan = planner.createPlan({
      runId: "run-replan-orig",
      userMessage: "Update dependencies",
      cwd: "/test",
      authoritativeRisk: "normal"
    });

    const newPlan = planner.replan(oldPlan, {
      runId: "run-replan-orig",
      userMessage: "Update dependencies",
      cwd: "/test",
      reason: "Unexpected package lock conflict"
    });

    expect(newPlan.planId).not.toBe(oldPlan.planId);
    expect(newPlan.replanCount).toBe(1);
    expect(newPlan.invalidationReason).toBe("Unexpected package lock conflict");
  });
});
