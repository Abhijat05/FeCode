import type { TaskPlan } from "./types.js";
import { summarizePlan } from "./taskPlan.js";

export class PlanFormatter {
  public static formatPlanDetail(plan: TaskPlan): string {
    const lines: string[] = [
      `Task Execution Plan: ${plan.planId}`,
      `Status:    [${plan.status.toUpperCase()}]`,
      `Objective: ${plan.objective}`
    ];

    if (plan.parentPlanId) {
      lines.push(`Parent Plan:  ${plan.parentPlanId} (depth ${plan.replanDepth ?? 0})`);
    }
    if (plan.replanReason) {
      lines.push(`Replan Reason: ${plan.replanReason}`);
    }
    lines.push("");

    if (plan.assumptions && plan.assumptions.length > 0) {
      lines.push("Assumptions:");
      plan.assumptions.forEach((a) => lines.push(`  • ${a}`));
      lines.push("");
    }

    lines.push("Execution Steps (Sequential):");
    plan.steps.forEach((step, idx) => {
      const num = idx + 1;
      const statusLabel =
        step.status === "completed"
          ? "completed ✓"
          : step.status === "in_progress"
            ? "executing ⧗"
            : step.status === "failed"
              ? "failed ✗"
              : step.status === "skipped"
                ? "skipped ⊘"
                : "planned";

      const depsStr =
        step.dependencies.length > 0
          ? step.dependencies.join(", ")
          : "none";

      const approvalStr = step.intent?.requiresApproval
        ? "required"
        : "not required";

      lines.push(`  [${num}] ${step.title}`);
      lines.push(`      Status:       ${statusLabel}`);
      lines.push(`      Type:         ${step.type}`);
      lines.push(`      Dependencies: ${depsStr}`);
      lines.push(`      Risk Level:   ${step.riskLevel}`);
      lines.push(`      Approval:     ${approvalStr}`);
      lines.push(`      Verification: ${step.verificationRequired ? "required" : "not required"}`);
      if (step.expectedFiles && step.expectedFiles.length > 0) {
        lines.push(`      Files:        ${step.expectedFiles.join(", ")}`);
      }
      if (step.error) {
        lines.push(`      Error:        ${step.error}`);
      }
      lines.push("");
    });

    if (plan.risks && plan.risks.length > 0) {
      lines.push("Estimated Risks:");
      plan.risks.forEach((r) => {
        lines.push(`  • [${r.level.toUpperCase()}] ${r.category}: ${r.description}`);
        if (r.mitigation) {
          lines.push(`    Mitigation: ${r.mitigation}`);
        }
      });
      lines.push("");
    }

    if (plan.checkpoints && plan.checkpoints.length > 0) {
      lines.push("Suggested Checkpoints:");
      plan.checkpoints.forEach((cp) => {
        lines.push(`  • ${cp.name} (${cp.timing}): ${cp.reason}`);
      });
      lines.push("");
    }

    if (plan.verificationStrategy && plan.verificationStrategy.length > 0) {
      lines.push(`Verification Strategy: ${plan.verificationStrategy.join(", ")}`);
    }

    if (plan.invalidationReason) {
      lines.push("");
      lines.push(`Plan Invalidation / Replan Reason: ${plan.invalidationReason}`);
    }

    return lines.join("\n");
  }

  public static formatPlanApprovalPrompt(plan: TaskPlan): string {
    const summary = summarizePlan(plan);
    const lines: string[] = [
      "Plan Requires Approval:",
      "",
      `  Plan ID:        ${plan.planId}`,
      `  Objective:      ${plan.objective}`,
      `  Total Steps:    ${summary.totalSteps}`,
      `  Highest Risk:   ${summary.highestRisk.toUpperCase()}`,
      `  Verification:   ${plan.verificationStrategy?.join(", ") || "standard"}`
    ];

    const affectedFiles: string[] = [];
    plan.steps.forEach((s) => {
      if (s.expectedFiles) {
        affectedFiles.push(...s.expectedFiles);
      }
      if (s.intent?.target) {
        affectedFiles.push(s.intent.target);
      }
    });
    const uniqueFiles = Array.from(new Set(affectedFiles));
    if (uniqueFiles.length > 0) {
      lines.push(`  Affected Files: ${uniqueFiles.join(", ")}`);
    }

    lines.push("");
    lines.push("Approve this execution plan? [y/N]");
    return lines.join("\n");
  }

  public static formatReplanPrompt(
    assessment: import("./types.js").ReplanAssessment
  ): string {
    const lines: string[] = [
      "Replanning Assessment:",
      "",
      `  Current Plan:   ${assessment.previousPlanId}`,
      `  Status:         [${(assessment.previousPlan?.status || "superseded").toUpperCase()}]`,
      `  Reason:         ${assessment.explanation || assessment.reason}`
    ];

    if (assessment.previousPlan) {
      const summary = summarizePlan(assessment.previousPlan);
      lines.push(
        `  Progress:       ${summary.completedSteps} / ${summary.totalSteps} steps completed`
      );
      if (assessment.affectedStepId) {
        lines.push(`  Affected Step:  ${assessment.affectedStepId}`);
      }
    }

    if (assessment.reassessedRisk) {
      lines.push(
        `  Assessed Risk:  ${assessment.reassessedRisk.level.toUpperCase()}`
      );
    }

    if (
      assessment.workspaceChanged &&
      assessment.workspaceDiffReasons &&
      assessment.workspaceDiffReasons.length > 0
    ) {
      lines.push(`  Workspace:      ${assessment.workspaceDiffReasons.join("; ")}`);
    }

    lines.push(`  Replan Depth:   ${assessment.replanDepth} / ${assessment.maxReplanDepth}`);
    lines.push("");
    lines.push("Create a new execution plan using the current workspace? [y/N]");
    return lines.join("\n");
  }

  public static formatPlanBlockedPrompt(
    plan: TaskPlan,
    assessment: import("./types.js").PlanAdaptationAssessment
  ): string {
    const failedStep = plan.steps.find(
      (s) => s.status === "failed" || assessment.affectedSteps.includes(s.stepId)
    );

    const stepIndex = failedStep
      ? (plan.steps.findIndex((s) => s.stepId === failedStep.stepId) + 1)
      : (plan.currentStepIndex ?? 0) + 1;

    const failedTitle = failedStep?.title || "Execution step";

    const reason =
      failedStep?.error ||
      assessment.feedback.find((f) => f.severity === "blocking")?.summary ||
      assessment.feedback[0]?.summary ||
      plan.invalidationReason ||
      "Plan execution was blocked by safety policy or failure";

    const lines: string[] = [
      "⚠ Plan execution blocked",
      "",
      `Plan: ${plan.planId}`,
      `Step: ${stepIndex}/${plan.steps.length} — ${failedTitle}`,
      "",
      "Reason:",
      reason,
      ""
    ];

    if (assessment.affectedSteps.length > 0) {
      lines.push("Affected steps:");
      for (const stepId of assessment.affectedSteps) {
        const sObj = plan.steps.find((s) => s.stepId === stepId);
        if (sObj) {
          lines.push(`  • Step ${sObj.order} — ${sObj.title}`);
        } else {
          lines.push(`  • Step ${stepId}`);
        }
      }
      lines.push("");
    }

    lines.push("Risk:");
    lines.push(assessment.currentRiskLevel);
    lines.push("");

    lines.push("Recommended action:");
    if (assessment.recommendedAction === "replan") {
      lines.push("Create a new execution plan using the current workspace.");
    } else if (assessment.recommendedAction === "retry") {
      lines.push("Retry the failed step with fresh permissions.");
    } else {
      lines.push("Cancel execution to avoid unintended changes.");
    }
    lines.push("");

    lines.push("What would you like to do?");
    lines.push("");
    lines.push("[c] Continue");
    lines.push("[r] Replan");
    lines.push("[x] Cancel");
    lines.push("");
    lines.push("Choice [x]:");

    return lines.join("\n");
  }
}
