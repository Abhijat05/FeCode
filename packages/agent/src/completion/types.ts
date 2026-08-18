import type { ChangeSet } from "../changes/types.js";
import type { ChangeAttribution, RepositorySnapshot } from "../git/types.js";

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

export interface FileChangeStats {
  path: string;
  operation: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface TaskCompletionSummary {
  taskId?: string;
  taskIndex?: number;
  request?: string;
  status: TaskCompletionStatus;
  startedAt?: string;
  completedAt?: string;
  completedFiles: string[];
  fileChanges?: FileChangeStats[];
  changeSet?: ChangeSet;
  gitBranch?: string | null;
  gitAttribution?: ChangeAttribution;
  baselineSnapshot?: RepositorySnapshot;
  verifiedCommands: string[];
  failedCommands?: string[];
  completedRequirements: string[];
  remainingRequirements: string[];
  blockedReason?: string;
  isNoOp?: boolean;
}
