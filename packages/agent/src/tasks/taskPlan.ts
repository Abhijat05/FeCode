import type { TaskPlan, TaskStep, TaskStatus } from "./types.js";

export function createTaskPlan(
  goal: string,
  steps: Array<string | { description: string; dependencies?: string[] }>
): TaskPlan {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const taskSteps: TaskStep[] = steps.map((s, idx) => {
    const desc = typeof s === "string" ? s : s.description;
    const deps = typeof s === "object" ? s.dependencies : undefined;
    return {
      id: `step-${idx + 1}`,
      description: desc,
      status: "pending",
      dependencies: deps
    };
  });

  return {
    id: planId,
    goal,
    steps: taskSteps,
    currentStep: 0,
    status: "pending"
  };
}

export function startTaskStep(
  plan: TaskPlan,
  stepIdOrIndex: string | number
): TaskPlan {
  const stepIndex =
    typeof stepIdOrIndex === "number"
      ? stepIdOrIndex
      : plan.steps.findIndex((s) => s.id === stepIdOrIndex);
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return plan;

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return { ...step, status: "in_progress" as TaskStatus, error: undefined };
    }
    return step;
  });

  return {
    ...plan,
    steps: updatedSteps,
    currentStep: stepIndex,
    status: "in_progress"
  };
}

export function completeTaskStep(
  plan: TaskPlan,
  stepIdOrIndex: string | number
): TaskPlan {
  const stepIndex =
    typeof stepIdOrIndex === "number"
      ? stepIdOrIndex
      : plan.steps.findIndex((s) => s.id === stepIdOrIndex);
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return plan;

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return { ...step, status: "completed" as TaskStatus };
    }
    return step;
  });

  const allCompleted = updatedSteps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  return {
    ...plan,
    steps: updatedSteps,
    status: allCompleted ? "completed" : "in_progress"
  };
}

export function failTaskStep(
  plan: TaskPlan,
  stepIdOrIndex: string | number,
  error?: string
): TaskPlan {
  const stepIndex =
    typeof stepIdOrIndex === "number"
      ? stepIdOrIndex
      : plan.steps.findIndex((s) => s.id === stepIdOrIndex);
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return plan;

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return { ...step, status: "failed" as TaskStatus, error };
    }
    return step;
  });

  return {
    ...plan,
    steps: updatedSteps,
    status: "failed"
  };
}

export function skipTaskStep(
  plan: TaskPlan,
  stepIdOrIndex: string | number
): TaskPlan {
  const stepIndex =
    typeof stepIdOrIndex === "number"
      ? stepIdOrIndex
      : plan.steps.findIndex((s) => s.id === stepIdOrIndex);
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return plan;

  const updatedSteps = plan.steps.map((step, idx) => {
    if (idx === stepIndex) {
      return { ...step, status: "skipped" as TaskStatus };
    }
    return step;
  });

  return {
    ...plan,
    steps: updatedSteps
  };
}

export function replanTask(
  plan: TaskPlan,
  newSteps: Array<string | { description: string; dependencies?: string[] }>
): TaskPlan {
  const completedSteps = plan.steps.filter(
    (s) => s.status === "completed" || s.status === "skipped"
  );
  const taskSteps: TaskStep[] = newSteps.map((s, idx) => {
    const desc = typeof s === "string" ? s : s.description;
    const deps = typeof s === "object" ? s.dependencies : undefined;
    return {
      id: `step-${completedSteps.length + idx + 1}`,
      description: desc,
      status: "pending",
      dependencies: deps
    };
  });

  const combined = [...completedSteps, ...taskSteps];
  return {
    ...plan,
    steps: combined,
    currentStep: completedSteps.length,
    status: "in_progress"
  };
}
