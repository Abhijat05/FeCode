import type {
  PlanStatus,
  PlanStep,
  PlanStepStatus,
  PlanSummary,
  TaskPlan
} from "./types.js";

const VALID_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["ready", "cancelled", "superseded"],
  ready: ["approved", "executing", "completed", "failed", "cancelled", "superseded", "blocked"],
  approved: ["executing", "completed", "failed", "cancelled", "superseded", "blocked"],
  executing: ["completed", "failed", "cancelled", "superseded", "blocked"],
  blocked: ["executing", "failed", "cancelled", "superseded"],
  completed: [],
  failed: ["superseded", "blocked"],
  cancelled: ["superseded"],
  superseded: []
};

export function createTaskPlan(params: {
  planId?: string;
  runId: string;
  userRequestSummary: string;
  objective: string;
  assumptions?: string[];
  steps: PlanStep[];
  risks?: TaskPlan["risks"];
  checkpoints?: TaskPlan["checkpoints"];
  verificationStrategy?: string[];
  status?: PlanStatus;
  replanCount?: number;
  parentPlanId?: string;
  rootPlanId?: string;
  replanDepth?: number;
  replanReason?: string;
}): TaskPlan {
  const planId =
    params.planId ||
    `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Ensure steps have sequential orders and initial statuses
  const orderedSteps: PlanStep[] = params.steps.map((step, idx) => ({
    ...step,
    order: step.order !== undefined ? step.order : idx + 1,
    status: step.status || "pending",
    dependencies: step.dependencies || []
  }));

  return {
    planId,
    runId: params.runId,
    createdAt: Date.now(),
    userRequestSummary: params.userRequestSummary,
    objective: params.objective,
    assumptions: params.assumptions || [],
    steps: orderedSteps,
    risks: params.risks || [],
    checkpoints: params.checkpoints || [],
    verificationStrategy: params.verificationStrategy || [
      "typecheck",
      "lint",
      "test"
    ],
    status: params.status || "ready",
    currentStepIndex: 0,
    replanCount: params.replanCount ?? 0,
    parentPlanId: params.parentPlanId,
    rootPlanId: params.rootPlanId || params.parentPlanId || planId,
    replanDepth: params.replanDepth ?? 0,
    replanReason: params.replanReason
  };
}

export function transitionPlanStatus(
  plan: TaskPlan,
  nextStatus: PlanStatus,
  reason?: string
): TaskPlan {
  if (plan.status === nextStatus) {
    return plan;
  }

  const allowed = VALID_TRANSITIONS[plan.status];
  if (!allowed || !allowed.includes(nextStatus)) {
    throw new Error(
      `Invalid plan status transition from "${plan.status}" to "${nextStatus}".`
    );
  }

  return {
    ...plan,
    status: nextStatus,
    invalidationReason:
      nextStatus === "superseded" ? reason || plan.invalidationReason : plan.invalidationReason
  };
}

export function canExecuteStep(
  plan: TaskPlan,
  stepId: string
): { canExecute: boolean; reason?: string } {
  const step = plan.steps.find((s) => s.stepId === stepId);
  if (!step) {
    return { canExecute: false, reason: `Step not found: ${stepId}` };
  }

  if (step.status === "completed") {
    return { canExecute: false, reason: `Step ${stepId} is already completed` };
  }

  if (step.status === "failed" || step.status === "skipped") {
    return { canExecute: false, reason: `Step ${stepId} is ${step.status}` };
  }

  for (const depId of step.dependencies) {
    const depStep = plan.steps.find((s) => s.stepId === depId);
    if (!depStep) {
      return {
        canExecute: false,
        reason: `Required dependency step ${depId} does not exist`
      };
    }
    if (depStep.status === "failed") {
      return {
        canExecute: false,
        reason: `Required dependency step ${depId} failed`
      };
    }
    if (depStep.status !== "completed") {
      return {
        canExecute: false,
        reason: `Required dependency step ${depId} has not completed (status: ${depStep.status})`
      };
    }
  }

  return { canExecute: true };
}

export function startPlanStep(plan: TaskPlan, stepId: string): TaskPlan {
  const check = canExecuteStep(plan, stepId);
  if (!check.canExecute) {
    throw new Error(`Cannot start step ${stepId}: ${check.reason}`);
  }

  const stepIndex = plan.steps.findIndex((s) => s.stepId === stepId);
  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return {
        ...step,
        status: "in_progress" as PlanStepStatus,
        error: undefined
      };
    }
    return step;
  });

  let nextStatus = plan.status;
  if (plan.status === "ready" || plan.status === "approved") {
    nextStatus = "executing";
  }

  return {
    ...plan,
    status: nextStatus,
    currentStepIndex: stepIndex,
    steps: updatedSteps
  };
}

export function completePlanStep(plan: TaskPlan, stepId: string): TaskPlan {
  const stepIndex = plan.steps.findIndex((s) => s.stepId === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`);
  }

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return {
        ...step,
        status: "completed" as PlanStepStatus,
        error: undefined
      };
    }
    return step;
  });

  const allCompleted = updatedSteps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  return {
    ...plan,
    status: allCompleted ? "completed" : plan.status,
    steps: updatedSteps
  };
}

export function failPlanStep(
  plan: TaskPlan,
  stepId: string,
  error?: string
): TaskPlan {
  const stepIndex = plan.steps.findIndex((s) => s.stepId === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`);
  }

  // Mark target step failed, and mark all direct & indirect downstream dependent steps skipped
  const failedStepIds = new Set<string>([stepId]);
  let addedMore = true;
  while (addedMore) {
    addedMore = false;
    for (const s of plan.steps) {
      if (
        !failedStepIds.has(s.stepId) &&
        s.dependencies.some((d) => failedStepIds.has(d))
      ) {
        failedStepIds.add(s.stepId);
        addedMore = true;
      }
    }
  }

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return {
        ...step,
        status: "failed" as PlanStepStatus,
        error: error || "Step execution failed"
      };
    }
    if (failedStepIds.has(step.stepId) && step.status === "pending") {
      return {
        ...step,
        status: "skipped" as PlanStepStatus,
        error: `Skipped because dependency ${stepId} failed`
      };
    }
    return step;
  });

  return {
    ...plan,
    status: "failed",
    steps: updatedSteps
  };
}

export function invalidatePlan(plan: TaskPlan, reason: string): TaskPlan {
  return transitionPlanStatus(plan, "superseded", reason);
}

export function blockPlan(plan: TaskPlan, reason: string): TaskPlan {
  return transitionPlanStatus(plan, "blocked", reason);
}

export function getFirstIncompleteStep(plan: TaskPlan): PlanStep | undefined {
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);
  return orderedSteps.find((s) => s.status !== "completed");
}

export function unblockPlan(plan: TaskPlan): TaskPlan {
  const updatedPlan = transitionPlanStatus(plan, "executing");
  const updatedSteps = updatedPlan.steps.map((step) => {
    // Preserve completed steps! Only reset failed/skipped/in_progress to pending
    if (
      step.status === "failed" ||
      step.status === "in_progress" ||
      step.status === "skipped"
    ) {
      return {
        ...step,
        status: "pending" as PlanStepStatus,
        error: undefined
      };
    }
    return step;
  });

  const firstIncompleteIdx = updatedSteps.findIndex(
    (s) => s.status !== "completed"
  );

  return {
    ...updatedPlan,
    currentStepIndex: firstIncompleteIdx >= 0 ? firstIncompleteIdx : 0,
    steps: updatedSteps
  };
}

export function summarizePlan(plan: TaskPlan): PlanSummary {
  const totalSteps = plan.steps.length;
  const completedSteps = plan.steps.filter(
    (s) => s.status === "completed"
  ).length;
  const failedStep = plan.steps.find((s) => s.status === "failed")?.stepId;

  // Determine highest risk among steps and plan risks
  const riskLevels = ["low", "normal", "elevated", "critical"] as const;
  let highestRiskIdx = 0;
  for (const step of plan.steps) {
    const idx = riskLevels.indexOf(step.riskLevel);
    if (idx > highestRiskIdx) highestRiskIdx = idx;
  }
  for (const r of plan.risks) {
    const idx = riskLevels.indexOf(r.level);
    if (idx > highestRiskIdx) highestRiskIdx = idx;
  }

  const requiresApproval = plan.steps.some(
    (s) =>
      s.intent?.requiresApproval ||
      s.type === "modify" ||
      s.type === "configure" ||
      s.riskLevel === "elevated" ||
      s.riskLevel === "critical"
  );

  return {
    planId: plan.planId,
    status: plan.status,
    objective: plan.objective,
    totalSteps,
    completedSteps,
    failedStep,
    currentStep: (plan.currentStepIndex ?? 0) + 1,
    replanCount: plan.replanCount,
    highestRisk: riskLevels[highestRiskIdx],
    requiresApproval,
    invalidationReason: plan.invalidationReason,
    parentPlanId: plan.parentPlanId,
    replanDepth: plan.replanDepth,
    replanReason: plan.replanReason
  };
}
