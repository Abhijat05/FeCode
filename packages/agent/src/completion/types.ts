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
  taskId?: string;
  taskIndex?: number;
  request?: string;
  status: TaskCompletionStatus;
  startedAt?: string;
  completedAt?: string;
  completedFiles: string[];
  verifiedCommands: string[];
  failedCommands?: string[];
  completedRequirements: string[];
  remainingRequirements: string[];
  blockedReason?: string;
  isNoOp?: boolean;
}
