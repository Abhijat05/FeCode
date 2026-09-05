import { describe, it, expect } from "vitest";
import { DefaultStepRetryPolicy } from "./retryPolicy.js";
import type { PlanStep } from "./types.js";

describe("DefaultStepRetryPolicy — Phase 5S", () => {
  const policy = new DefaultStepRetryPolicy({ maxAttempts: 2 });

  const nonDestructiveStep: PlanStep = {
    stepId: "step-modify-1",
    order: 1,
    title: "Modify Button.tsx",
    objective: "Add button onClick handler",
    type: "modify",
    dependencies: [],
    riskLevel: "normal",
    verificationRequired: true,
    status: "pending",
    intent: {
      type: "modify_file",
      target: "Button.tsx",
      reason: "Edit handler",
      requiresApproval: false,
      estimatedRisk: "normal"
    }
  };

  const destructiveStep: PlanStep = {
    stepId: "step-delete-1",
    order: 2,
    title: "Delete unused temp file",
    objective: "Remove temp file",
    type: "modify",
    dependencies: [],
    riskLevel: "critical",
    verificationRequired: false,
    status: "pending",
    intent: {
      type: "delete_file",
      target: "temp.txt",
      reason: "Remove file",
      requiresApproval: true,
      estimatedRisk: "critical"
    }
  };

  it("permits retry for non-destructive verification failure within maxAttempts", () => {
    expect(policy.canRetry(nonDestructiveStep, 1, "verification_failed")).toBe(true);
    expect(policy.getRemainingAttempts("step-modify-1", 1)).toBe(1);
  });

  it("permits retry for non-destructive tool failure within maxAttempts", () => {
    expect(policy.canRetry(nonDestructiveStep, 1, "tool_failure")).toBe(true);
  });

  it("rejects retry when maxAttempts reached (bounded)", () => {
    expect(policy.canRetry(nonDestructiveStep, 2, "verification_failed")).toBe(false);
    expect(policy.getRemainingAttempts("step-modify-1", 2)).toBe(0);
  });

  it("strictly rejects retry for destructive operations (delete_file)", () => {
    expect(policy.canRetry(destructiveStep, 1, "verification_failed")).toBe(false);
    expect(policy.canRetry(destructiveStep, 1, "tool_failure", "delete")).toBe(false);
  });

  it("rejects retry for non-retryable failure kinds like workspace_drift", () => {
    expect(policy.canRetry(nonDestructiveStep, 1, "workspace_drift")).toBe(false);
    expect(policy.canRetry(nonDestructiveStep, 1, "dependency_changed")).toBe(false);
    expect(policy.canRetry(nonDestructiveStep, 1, "configuration_changed")).toBe(false);
  });

  it("enforces fresh risk assessment and fresh permission flags", () => {
    expect(policy.requiresFreshRiskAssessment).toBe(true);
    expect(policy.requiresFreshPermission).toBe(true);
  });

  it("calculates exponential backoff when backoffMs is configured", () => {
    const backoffPolicy = new DefaultStepRetryPolicy({ maxAttempts: 3, backoffMs: 100 });
    expect(backoffPolicy.getBackoffMs(1)).toBe(100);
    expect(backoffPolicy.getBackoffMs(2)).toBe(200);
    expect(backoffPolicy.getBackoffMs(3)).toBe(400);

    const defaultPolicy = new DefaultStepRetryPolicy();
    expect(defaultPolicy.getBackoffMs(1)).toBe(0);
  });
});
