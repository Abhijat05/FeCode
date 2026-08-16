export type TaskCompletionStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export type RequirementStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export interface TaskRequirement {
  id: string;
  description: string;
  status: RequirementStatus;
  targetPath?: string;
}

export interface TaskCompletionSummary {
  status: TaskCompletionStatus;
  completedFiles: string[];
  verifiedCommands: string[];
  completedRequirements: string[];
  remainingRequirements: string[];
  blockedReason?: string;
}
