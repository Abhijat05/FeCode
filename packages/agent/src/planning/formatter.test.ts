import { describe, it, expect } from "vitest";
import { createTaskPlan } from "./taskPlan.js";
import { PlanFormatter } from "./formatter.js";

describe("PlanFormatter — Phase 5P", () => {
  it("formats plan details with clear distinction between planned, executing, and completed steps", () => {
    const plan = createTaskPlan({
      runId: "run-fmt-1",
      userRequestSummary: "Fix user profile bug",
      objective: "Fix user profile bug",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect profile component",
          objective: "Read component code",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Update profile form",
          objective: "Fix validation error",
          type: "modify",
          dependencies: ["step-1"],
          expectedFiles: ["src/Profile.tsx"],
          riskLevel: "normal",
          verificationRequired: true,
          status: "in_progress",
          intent: {
            type: "modify_file",
            target: "src/Profile.tsx",
            reason: "Fix form validation",
            requiresApproval: true,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-3",
          order: 3,
          title: "Run tests",
          objective: "Run unit tests",
          type: "test",
          dependencies: ["step-2"],
          riskLevel: "low",
          verificationRequired: true,
          status: "pending"
        }
      ],
      risks: [
        {
          level: "normal",
          category: "ui_change",
          description: "May affect visual layout"
        }
      ],
      checkpoints: [
        {
          name: "checkpoint-pre-mutation",
          reason: "Before modifying profile",
          timing: "before_mutation"
        }
      ],
      verificationStrategy: ["typecheck", "test"]
    });

    const formatted = PlanFormatter.formatPlanDetail(plan);
    expect(formatted).toContain("Task Execution Plan: " + plan.planId);
    expect(formatted).toContain("Status:    [READY]");
    expect(formatted).toContain("[1] Inspect profile component");
    expect(formatted).toContain("Status:       completed ✓");
    expect(formatted).toContain("[2] Update profile form");
    expect(formatted).toContain("Status:       executing ⧗");
    expect(formatted).toContain("[3] Run tests");
    expect(formatted).toContain("Status:       planned");
    expect(formatted).toContain("Suggested Checkpoints:");
    expect(formatted).toContain("Verification Strategy: typecheck, test");
  });

  it("formats plan approval prompt with affected files, step counts, and [y/N]", () => {
    const plan = createTaskPlan({
      runId: "run-fmt-2",
      userRequestSummary: "Migrate database schema",
      objective: "Migrate database schema to v2",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect schema",
          objective: "Read schema",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "pending"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Apply migrations",
          objective: "Run migration SQL",
          type: "modify",
          dependencies: ["step-1"],
          expectedFiles: ["db/schema.sql"],
          riskLevel: "elevated",
          verificationRequired: true,
          status: "pending",
          intent: {
            type: "modify_file",
            target: "db/schema.sql",
            reason: "Apply v2 migration",
            requiresApproval: true,
            estimatedRisk: "elevated"
          }
        }
      ]
    });

    const prompt = PlanFormatter.formatPlanApprovalPrompt(plan);
    expect(prompt).toContain("Plan Requires Approval:");
    expect(prompt).toContain("db/schema.sql");
    expect(prompt).toContain("Approve this execution plan? [y/N]");
  });
});
