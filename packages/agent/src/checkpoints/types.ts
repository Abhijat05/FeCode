export type CheckpointStatus =
  | "created"
  | "active"
  | "ready"
  | "restored"
  | "discarded"
  | "invalid"
  | "expired";

export interface CheckpointFile {
  path: string;
  status: string;
  hash?: string;
  size?: number;
}

export interface Checkpoint {
  id: string;
  taskId?: string;
  createdAt: string;
  repositoryRoot: string;
  branch: string | null;
  files: CheckpointFile[];
  totalFiles: number;
  status: CheckpointStatus;
  isGit: boolean;
  storagePath?: string;
  reason?: string;
  reasons?: string[];
  affectedFiles?: string[];
}

export interface CheckpointContext {
  cwd: string;
  reason?: string;
  reasons?: string[];
  affectedFiles?: string[];
  taskId?: string;
  signal?: AbortSignal;
}

export interface CheckpointCreateOptions {
  taskId?: string;
  cwd: string;
  reason?: string;
  reasons?: string[];
  affectedFiles?: string[];
  signal?: AbortSignal;
}

export interface CheckpointResult {
  success: boolean;
  checkpoint?: Checkpoint;
  error?: string;
  code?: "CHECKPOINT_CREATED" | "CHECKPOINT_UNAVAILABLE" | "CHECKPOINT_FAILED" | "ABORTED";
}

export interface CheckpointComparisonFile {
  path: string;
  operation: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface CheckpointComparison {
  checkpointId: string;
  createdAt: string;
  files: CheckpointComparisonFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface RiskAssessment {
  risky: boolean;
  reasons: string[];
}

export interface RiskAssessmentThresholds {
  maxSafeFiles?: number;
  maxSafeLines?: number;
}

export interface RiskAssessmentOptions {
  request?: string;
  expectedFilesCount?: number;
  expectedLinesCount?: number;
  modifiedFilePaths?: string[];
  verificationAttempts?: number;
  hasFailedVerification?: boolean;
  thresholds?: RiskAssessmentThresholds;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  get(id: string): Promise<Checkpoint | null>;
  list(): Promise<Checkpoint[]>;
  remove(id: string): Promise<void>;
}

export interface CheckpointManager {
  create(
    options: CheckpointCreateOptions | CheckpointContext
  ): Promise<CheckpointResult>;
  get(id: string): Promise<Checkpoint | null>;
  inspect(id: string): Promise<Checkpoint | null>;
  compare(id: string, cwd: string): Promise<CheckpointComparison>;
  list(): Promise<Checkpoint[]>;
  remove(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  restore(
    id: string,
    options?: import("../recovery/types.js").RecoveryOptions
  ): Promise<import("../recovery/types.js").RecoveryResult>;
}
