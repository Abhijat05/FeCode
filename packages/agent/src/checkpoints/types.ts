export type CheckpointStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "consumed"
  | "invalidated"
  | "cancelled"
  | "created"
  | "active"
  | "ready"
  | "restored"
  | "discarded"
  | "invalid";

export interface CheckpointFile {
  path: string;
  status: string;
  hash?: string;
  size?: number;
}

export interface CheckpointApproval {
  approved: boolean;
  approvedBy: "user" | "policy";
  decision: "approved" | "rejected";
  timestamp: number;
  reason?: string;
}

export interface CheckpointRecord {
  checkpointId: string;
  runId: string;
  planId?: string;
  stepId?: string;
  stepOrder?: number;
  createdAt: number;
  expiresAt?: number;
  riskLevel: import("../policy/types.js").TaskRiskLevel;
  reason: string;
  affectedTargets: string[];
  requiredAction?: string;
  status: CheckpointStatus;
  approval?: CheckpointApproval;
  consumedAt?: number;
  invalidationReason?: string;
  branch?: string | null;
  fingerprint?: string;
}

export interface CheckpointValidationContext {
  runId: string;
  planId?: string;
  stepId?: string;
  riskLevel: import("../policy/types.js").TaskRiskLevel;
  cwd: string;
  affectedTargets?: string[];
  gitRepository?: import("../git/types.js").GitRepository;
  initialFingerprint?: import("../history/types.js").WorkspaceFingerprint;
}

export interface CheckpointValidationResult {
  valid: boolean;
  status: CheckpointStatus;
  checkpointId: string;
  reason?: string;
  invalidated?: boolean;
}

export interface CheckpointConsumptionResult {
  success: boolean;
  checkpointId: string;
  status: CheckpointStatus;
  consumedAt?: number;
  error?: string;
}

export interface CheckpointApprovalRequest {
  runId: string;
  planId?: string;
  stepId?: string;
  stepOrder?: number;
  riskLevel: import("../policy/types.js").TaskRiskLevel;
  reason: string;
  affectedTargets: string[];
  requiredAction?: string;
  cwd: string;
  ttlMs?: number;
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

  requestApproval?(
    request: CheckpointApprovalRequest
  ): Promise<CheckpointRecord>;
  approve?(
    checkpointId: string,
    approval: CheckpointApproval
  ): Promise<CheckpointRecord>;
  reject?(
    checkpointId: string,
    reason?: string
  ): Promise<CheckpointRecord>;
  validateApproval?(
    checkpointId: string,
    context: CheckpointValidationContext
  ): Promise<CheckpointValidationResult>;
  consume?(
    checkpointId: string,
    context: CheckpointValidationContext
  ): Promise<CheckpointConsumptionResult>;
  invalidate?(
    checkpointId: string,
    reason: string
  ): Promise<CheckpointRecord>;
  getRecord?(
    checkpointId: string
  ): Promise<CheckpointRecord | null>;
  listRecords?(
    filter?: { runId?: string; planId?: string; status?: CheckpointStatus }
  ): Promise<CheckpointRecord[]>;
}
