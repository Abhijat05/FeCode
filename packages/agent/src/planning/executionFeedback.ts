import type { TaskRiskLevel } from "../policy/types.js";
import type {
  ExecutionFeedback,
  ExecutionFeedbackAction,
  ExecutionFeedbackInput,
  ExecutionFeedbackKind,
  ExecutionFeedbackManager,
  ExecutionFeedbackSeverity,
  PlanAdaptationAssessment,
  TaskPlan
} from "./types.js";

const DEFAULT_SEVERITIES: Record<ExecutionFeedbackKind, ExecutionFeedbackSeverity> = {
  step_completed: "info",
  step_failed: "blocking",
  verification_failed: "warning",
  workspace_drift: "blocking",
  dependency_changed: "blocking",
  configuration_changed: "blocking",
  unexpected_file_change: "blocking",
  tool_failure: "warning",
  command_failure: "warning"
};

const DEFAULT_ACTIONS: Record<ExecutionFeedbackKind, ExecutionFeedbackAction> = {
  step_completed: "continue",
  step_failed: "replan",
  verification_failed: "retry",
  workspace_drift: "replan",
  dependency_changed: "replan",
  configuration_changed: "replan",
  unexpected_file_change: "replan",
  tool_failure: "retry",
  command_failure: "retry"
};

export class DefaultExecutionFeedbackManager implements ExecutionFeedbackManager {
  private readonly feedbackList: ExecutionFeedback[] = [];

  public recordFeedback(feedback: ExecutionFeedbackInput): ExecutionFeedback {
    const feedbackId =
      feedback.feedbackId ||
      `feedback-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const detectedAt = feedback.detectedAt || Date.now();

    const kind = feedback.kind;
    const severity = feedback.severity || DEFAULT_SEVERITIES[kind] || "warning";
    const recommendedAction =
      feedback.recommendedAction || DEFAULT_ACTIONS[kind] || "replan";

    const requiresReplanning =
      feedback.requiresReplanning !== undefined
        ? feedback.requiresReplanning
        : kind === "workspace_drift" ||
          kind === "configuration_changed" ||
          kind === "dependency_changed" ||
          kind === "unexpected_file_change" ||
          (severity === "blocking" && recommendedAction === "replan");

    const requiresUserConfirmation =
      feedback.requiresUserConfirmation !== undefined
        ? feedback.requiresUserConfirmation
        : severity === "blocking" || requiresReplanning;

    const record: ExecutionFeedback = Object.freeze({
      feedbackId,
      runId: feedback.runId,
      planId: feedback.planId,
      stepId: feedback.stepId,
      kind,
      severity,
      summary: feedback.summary,
      details: feedback.details,
      detectedAt,
      requiresReplanning,
      requiresUserConfirmation,
      recommendedAction
    });

    this.feedbackList.push(record);
    return record;
  }

  public getFeedback(runIdOrPlanId: string): ExecutionFeedback[] {
    return this.feedbackList
      .filter((f) => f.runId === runIdOrPlanId || f.planId === runIdOrPlanId)
      .map((f) => ({ ...f }));
  }

  public getPlanFeedback(planId: string): ExecutionFeedback[] {
    return this.feedbackList
      .filter((f) => f.planId === planId)
      .map((f) => ({ ...f }));
  }

  public assessPlanAdaptation(
    plan: TaskPlan,
    context?: { cwd?: string; riskLevel?: TaskRiskLevel }
  ): PlanAdaptationAssessment {
    const planFeedback = this.getPlanFeedback(plan.planId);
    const affectedStepsSet = new Set<string>();

    // 1. Identify directly affected steps from feedback
    for (const f of planFeedback) {
      if (f.stepId) {
        affectedStepsSet.add(f.stepId);
      }
    }

    // 2. Identify failed steps and cascade to downstream dependencies
    const failedOrBlockedStepIds = new Set<string>();
    for (const s of plan.steps) {
      if (s.status === "failed" || affectedStepsSet.has(s.stepId)) {
        failedOrBlockedStepIds.add(s.stepId);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const step of plan.steps) {
        if (
          !affectedStepsSet.has(step.stepId) &&
          step.dependencies.some((dep) => failedOrBlockedStepIds.has(dep))
        ) {
          affectedStepsSet.add(step.stepId);
          failedOrBlockedStepIds.add(step.stepId);
          changed = true;
        }
      }
    }

    // 3. If workspace drift or unexpected external changes occurred, all pending steps are affected
    const hasGlobalDrift = planFeedback.some(
      (f) =>
        f.kind === "workspace_drift" ||
        f.kind === "configuration_changed" ||
        f.kind === "dependency_changed" ||
        f.kind === "unexpected_file_change"
    );

    if (hasGlobalDrift) {
      for (const step of plan.steps) {
        if (step.status !== "completed") {
          affectedStepsSet.add(step.stepId);
        }
      }
    }

    const hasBlockingFeedback = planFeedback.some(
      (f) => f.severity === "blocking"
    );

    const requiresReplanning = planFeedback.some((f) => f.requiresReplanning);

    const hasRetryableWarning = planFeedback.some(
      (f) => f.severity === "warning" && f.recommendedAction === "retry"
    );

    const canContinue =
      !hasBlockingFeedback &&
      !requiresReplanning &&
      plan.status !== "blocked" &&
      plan.status !== "failed" &&
      plan.status !== "cancelled" &&
      plan.status !== "superseded";

    const canRetry = !canContinue && hasRetryableWarning && !hasGlobalDrift;
    const canAdapt =
      requiresReplanning || hasBlockingFeedback || plan.status === "blocked" || plan.status === "failed";

    let recommendedAction: ExecutionFeedbackAction = "continue";
    if (requiresReplanning || hasGlobalDrift) {
      recommendedAction = "replan";
    } else if (hasBlockingFeedback) {
      recommendedAction = "replan";
    } else if (canRetry) {
      recommendedAction = "retry";
    } else if (!canContinue) {
      recommendedAction = "cancel";
    }

    // Determine highest risk level
    const riskRanks: Record<TaskRiskLevel, number> = {
      low: 1,
      normal: 2,
      elevated: 3,
      critical: 4
    };

    let highestRisk: TaskRiskLevel = context?.riskLevel || "normal";
    if (plan.risks && plan.risks.length > 0) {
      for (const r of plan.risks) {
        if (riskRanks[r.level] > riskRanks[highestRisk]) {
          highestRisk = r.level;
        }
      }
    }
    for (const step of plan.steps) {
      if (riskRanks[step.riskLevel] > riskRanks[highestRisk]) {
        highestRisk = step.riskLevel;
      }
    }

    const requiresUserConfirmation =
      hasBlockingFeedback ||
      requiresReplanning ||
      plan.status === "blocked" ||
      recommendedAction === "replan";

    return {
      planId: plan.planId,
      assessedAt: Date.now(),
      canContinue,
      canRetry,
      canAdapt,
      feedback: planFeedback,
      affectedSteps: Array.from(affectedStepsSet),
      currentRiskLevel: highestRisk,
      requiresUserConfirmation,
      recommendedAction
    };
  }

  public clearFeedback(runIdOrPlanId?: string): void {
    if (!runIdOrPlanId) {
      this.feedbackList.length = 0;
      return;
    }

    const filtered = this.feedbackList.filter(
      (f) => f.runId !== runIdOrPlanId && f.planId !== runIdOrPlanId
    );
    this.feedbackList.length = 0;
    this.feedbackList.push(...filtered);
  }
}
