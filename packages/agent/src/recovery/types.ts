export interface RecoveryConflict {
  path: string;
  reason: string;
}

export interface RecoverySafetyCheck {
  safe: boolean;
  conflicts: RecoveryConflict[];
  affectedFiles: string[];
  preservedFiles: string[];
  reasons: string[];
}

export interface RecoveryPreviewFile {
  path: string;
  operation: "restore" | "delete" | "revert";
  additions: number;
  deletions: number;
}

export interface RecoveryPreview {
  checkpointId: string;
  currentBranch: string | null;
  checkpointBranch: string | null;
  repositoryRoot: string;
  files: RecoveryPreviewFile[];
  totalFiles: number;
  preExistingFiles: string[];
  safe: boolean;
  reasons: string[];
  conflicts: RecoveryConflict[];
}

export interface RecoveryOptions {
  cwd: string;
  signal?: AbortSignal;
  approved?: boolean;
}

export interface RecoveryResult {
  success: boolean;
  checkpointId: string;
  status: "completed" | "blocked" | "cancelled" | "failed";
  recoveredFiles: string[];
  preservedFiles: string[];
  conflicts: RecoveryConflict[];
  error?: string;
  emergencySnapshotPath?: string;
}

export interface RecoveryRecord {
  checkpointId: string;
  startedAt: string;
  completedAt?: string;
  status: "completed" | "blocked" | "cancelled" | "failed";
  affectedFiles: string[];
  preservedFiles: string[];
  conflicts: string[];
}

export interface RecoveryManager {
  preview(checkpointId: string, cwd: string): Promise<RecoveryPreview>;
  recover(
    checkpointId: string,
    options: RecoveryOptions
  ): Promise<RecoveryResult>;
  getLastRecord(): RecoveryRecord | null;
}
