import type { AgentRunStatus, AgentRunTransition } from "../run/types.js";
import type { TaskRiskLevel, TaskRiskAssessment } from "../policy/types.js";
import type {
  ToolDiagnosticRecord,
  CommandDiagnosticRecord,
  RecoveryDiagnosticRecord,
  RunFilesSummary,
  RunSummary
} from "../diagnostics/types.js";

export interface WorkspaceFingerprint {
  gitCommitHash?: string;
  gitBranch?: string;
  isGitDirty?: boolean;
  fileFingerprints?: Record<
    string,
    { mtimeMs?: number; size?: number; hash?: string }
  >;
  capturedAt: number;
}

export interface DurableRunRecord {
  schemaVersion: 1;
  runId: string;
  parentRunId?: string;
  resumeDepth?: number;
  projectId: string;
  cwd: string;
  userRequestSummary: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  finalStatus: AgentRunStatus | "interrupted";
  executionState: "completed" | "failed" | "cancelled" | "interrupted";
  activeSkills: string[];
  initialRiskLevel: TaskRiskLevel;
  riskReasons: string[];
  requiresCheckpoint: boolean;
  requiresExplicitApproval: boolean;
  checkpointId?: string;
  verificationAttempts: number;
  maxVerificationAttempts: number;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
  tools: ToolDiagnosticRecord[];
  commands: CommandDiagnosticRecord[];
  recovery?: RecoveryDiagnosticRecord[];
  files: RunFilesSummary;
  lifecycleTransitions: AgentRunTransition[];
  workspaceFingerprint?: WorkspaceFingerprint;
  failureReason?: string;
  failureCode?: string;
  cancellationReason?: string;
  planId?: string;
  planStatus?: import("../planning/types.js").PlanStatus;
  totalPlanSteps?: number;
  completedPlanSteps?: number;
  failedPlanStep?: string;
  skippedPlanSteps?: number;
  replanCount?: number;
  parentPlanId?: string;
  replanDepth?: number;
  replanReason?: string;
  replanTimestamp?: number;
  planSummary?: string;
  planExecutionDurationMs?: number;
  feedbackCount?: number;
  blockingFeedbackCount?: number;
  retryCount?: number;
  adaptationCount?: number;
  blockedPlanSteps?: string[];
  planAdaptationReasons?: string[];
  decisionRequestedAt?: number;
  decisionResolvedAt?: number;
  executionDecision?: import("../planning/types.js").ExecutionDecision;
  decisionReason?: string;
  decisionOutcome?: "accepted" | "rejected" | "superseded" | "cancelled";
  resumedFromStepId?: string;
  resumedStepOrder?: number;
  decisionCount?: number;
  reconciliationId?: string;
  reconciliationStatus?: import("../planning/types.js").FinalReconciliationStatus;
  reconciliationStartedAt?: number;
  reconciliationCompletedAt?: number;
  expectedFileCount?: number;
  modifiedFileCount?: number;
  unexpectedFileCount?: number;
  missingFileCount?: number;
  reconciliationConsistent?: boolean;
  reconciliationFailureReason?: string;
  executionRecoveryCount?: number;
  lastRecoveryStrategy?: import("../planning/types.js").RecoveryStrategy;
  lastRecoveryStatus?:
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled"
    | import("../planning/types.js").RecoveryOutcomeStatus;
  lastRecoveryOutcome?: import("../planning/types.js").RecoveryOutcomeStatus;
  lastRecoveryDurationMs?: number;
  repairedFiles?: string[];
  lastRecoveryCompletedActions?: import("../planning/types.js").RepairAction[];
  lastRecoveryFailedActions?: import("../planning/types.js").FailedRecoveryAction[];
  lastRecoveryWorkspaceConsistent?: boolean;
  lastRecoveryFinalPlanStatus?: import("../planning/types.js").PlanStatus;
  lastRecoveryBlockingReasons?: string[];
  recoveryFailureReason?: string;
  recoveryLineage?: {
    recoveryId: string;
    parentRecoveryId?: string;
    strategy: import("../planning/types.js").RecoveryStrategy;
    depth: number;
    status: string;
    timestamp: number;
  }[];
  continuationCount?: number;
  lastContinuationDecision?: import("../planning/types.js").RecoveryContinuationDecision;
  lastContinuationStatus?: import("../planning/types.js").ContinuationStatus;
  lastContinuationResumedSteps?: string[];
  lastContinuationDurationMs?: number;
  lastContinuationBlockingReasons?: string[];
  continuationFailureReason?: string;
  checkpointRecordCount?: number;
  lastCheckpointStatus?: import("../checkpoints/types.js").CheckpointStatus;
  lastCheckpointId?: string;
  lastCheckpointRiskLevel?: import("../policy/types.js").TaskRiskLevel;
  lastCheckpointReason?: string;
  checkpointRecords?: import("../checkpoints/types.js").CheckpointRecord[];
}

export interface RunHistoryStoreOptions {
  storageDir?: string;
  maxRuns?: number;
  maxSizeBytes?: number;
}

export interface RunHistoryStore {
  getStorageDir(): string;
  saveRun(
    record: DurableRunRecord | RunSummary,
    projectId?: string,
    fingerprint?: WorkspaceFingerprint,
    parentRunId?: string,
    resumeDepth?: number
  ): Promise<void>;
  getRun(runId: string): Promise<DurableRunRecord | null>;
  getRunLineage(runId: string): Promise<DurableRunRecord[]>;
  listRuns(options?: {
    projectId?: string;
    limit?: number;
  }): Promise<DurableRunRecord[]>;
  deleteRun(runId: string): Promise<boolean>;
  clearRuns(projectId?: string): Promise<void>;
  prune(maxRuns?: number, maxSizeBytes?: number): Promise<number>;
}

export interface ResumePreparation {
  canResume: boolean;
  originalRun: DurableRunRecord;
  suggestedParentRunId: string;
  newRunId: string;
  resumeDepth: number;
  workspaceChanged: boolean;
  workspaceDiffReasons: string[];
  reassessedRisk: TaskRiskAssessment;
  reassessedSkills: string[];
  requiresUserConfirmation: boolean;
  explanation: string;
}

export interface ResumeRunOptions {
  cwd?: string;
  approved?: boolean;
}

export interface ResumeManager {
  prepareResume(
    runId: string,
    currentCwd: string
  ): Promise<ResumePreparation>;
  buildResumeContext(
    originalRun: DurableRunRecord,
    prep: ResumePreparation
  ): string;
}
