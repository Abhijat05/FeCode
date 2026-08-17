export type ChangeSetOperation = "added" | "modified" | "deleted";

export interface ChangeSetFile {
  path: string;
  operation: ChangeSetOperation;
  additions: number;
  deletions: number;
}

export interface ChangeSetCommand {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  succeeded: boolean;
}

export interface VerificationSummary {
  attempted: boolean;
  passed: boolean;
  commands: string[];
  failedCommands: string[];
}

export interface ChangeSetStats {
  totalFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface ChangeSet {
  taskId?: string;
  files: ChangeSetFile[];
  stats: ChangeSetStats;
  areas: string[];
  categories: string[];
  commands: ChangeSetCommand[];
  verification: VerificationSummary;
}
