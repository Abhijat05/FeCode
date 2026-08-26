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
    lines.push("[c] Continue — resume incomplete steps after fresh safety checks");
    lines.push("[r] Replan  — create a new plan from the current workspace");
    lines.push("[x] Cancel  — stop execution");
    lines.push("");
    lines.push("Choice [x]:");

    return lines.join("\n");
  }

  public static formatResumeNotice(
    planId: string,
    stepIndex: number,
    totalSteps: number,
    stepTitle: string
  ): string {
    return `↻ Resuming plan ${planId}\nStarting from step ${stepIndex}/${totalSteps}: ${stepTitle}`;
  }

  public static formatReplanNotice(): string {
    return "→ Existing plan preserved\n→ Creating replacement plan";
  }

  public static formatCancelNotice(): string {
    return "✓ Plan cancelled";
  }

  public static formatReconciliationBlockedPrompt(
    _plan: TaskPlan,
    result: import("./types.js").FinalReconciliationResult
  ): string {
    const lines: string[] = [
      "⚠ Final workspace reconciliation failed",
      "",
      "Reason:",
      result.failureReason || "Workspace state did not match execution plan",
      ""
    ];

    if (result.missingFiles && result.missingFiles.length > 0) {
      lines.push("Missing expected files:");
      result.missingFiles.forEach((f) => lines.push(`  • ${f}`));
      lines.push("");
    }

    if (result.unexpectedFiles && result.unexpectedFiles.length > 0) {
      lines.push("Unexpected changes:");
      result.unexpectedFiles.forEach((f) => lines.push(`  • ${f}`));
      lines.push("");
    }

    lines.push("What would you like to do?");
    lines.push("");
    lines.push("[r] Recover");
    lines.push("[p] Replan");
    lines.push("[c] Re-check workspace");
    lines.push("[x] Cancel");
    lines.push("");
    lines.push("Choice [x]:");

    return lines.join("\n");
  }

  public static formatRecoveryAssessment(
    assessment: import("./types.js").ExecutionRecoveryAssessment
  ): string {
    const lines: string[] = [
      "Recovery assessment",
      "",
      `Strategy: ${assessment.strategy}`,
      `Risk: ${assessment.riskLevel}`,
      `Affected files: ${assessment.affectedFiles.length > 0 ? assessment.affectedFiles.join(", ") : "none"}`,
      `Affected steps: ${assessment.affectedSteps.length}`,
      `Fresh approval required: ${assessment.requiresExplicitApproval ? "yes" : "no"}`,
      "",
      "Proceed with recovery? [y/N]:"
    ];
    return lines.join("\n");
  }

  public static formatRecoveryOutcome(
    result: import("./types.js").ExecutionRecoveryResult
  ): string {
    const lines: string[] = [];

    if (result.outcome === "recovered") {
      lines.push("Recovery completed");
      lines.push("");
      lines.push(`Strategy: ${result.strategy}`);
      lines.push(`Files repaired: ${result.repairedFiles.length}`);
      lines.push("");
      lines.push("Verification");
      lines.push("✓ passed");
      lines.push("");
      lines.push("Workspace reconciliation");
      lines.push("✓ Workspace consistent");
      lines.push("");
      lines.push("Recovery outcome: RECOVERED");
    } else if (result.outcome === "recovered_with_changes") {
      lines.push("Recovery completed with changes");
      lines.push("");
      lines.push(`Strategy: ${result.strategy}`);
      lines.push(`Files repaired: ${result.repairedFiles.length}`);
      lines.push("");
      lines.push("Verification");
      lines.push("✓ passed");
      lines.push("");
      lines.push("Workspace reconciliation");
      lines.push("✓ consistent with accepted recovery state");
      lines.push("");
      lines.push("Recovery outcome: RECOVERED_WITH_CHANGES");
    } else if (result.outcome === "still_blocked") {
      lines.push("Recovery incomplete");
      lines.push("");
      lines.push(`Strategy: ${result.strategy}`);
      lines.push(
        `Completed repairs: ${result.completedRecoveryActions?.length || 0}`
      );
      lines.push(
        `Failed repairs: ${result.failedRecoveryActions?.length || 0}`
      );
      lines.push("");
      lines.push(
        `Verification: ${result.verificationResult?.success ? "✓ passed" : "✗ failed"}`
      );
      lines.push(
        `Workspace reconciliation: ${result.workspaceConsistent ? "✓ consistent" : "✗ inconsistent"}`
      );
      lines.push("");
      lines.push("Recovery outcome: STILL BLOCKED");
      if (result.blockingReasons && result.blockingReasons.length > 0) {
        lines.push("");
        lines.push("Remaining blockers:");
        result.blockingReasons.forEach((b) => lines.push(`  • ${b}`));
      }
      lines.push("");
      lines.push("What would you like to do?");
      lines.push("");
      lines.push("[r] Replan");
      lines.push("[c] Re-check");
      lines.push("[x] Cancel");
      lines.push("");
      lines.push("Choice [x]:");
    } else if (result.outcome === "cancelled") {
      lines.push("✓ Recovery cancelled");
    } else {
      lines.push(`✗ Recovery failed: ${result.failureReason || "unknown error"}`);
    }

    return lines.join("\n");
  }

  public static formatContinuationPrompt(
    plan?: import("./types.js").TaskPlan
  ): string {
    const title = plan?.userRequestSummary ? ` (${plan.userRequestSummary})` : "";
    return `Plan${title}: ready to continue\n\nContinue remaining plan steps? [y/N]:`;
  }
}
