export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  dependencies?: string[];
  error?: string;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStep?: number;
  status?: TaskStatus;
}
