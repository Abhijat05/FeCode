import type { AgentRunStatus, AgentRunTransition } from "../run/types.js";
import type { TaskRiskLevel } from "../policy/types.js";
import type { AgentEvent } from "../index.js";

export interface ToolDiagnosticRecord {
  toolName: string;
  callId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  success?: boolean;
  errorCode?: string;
  targetPath?: string;
  permissionOutcome?: "allowed" | "denied" | "requires_approval" | "approved";
}

export interface CommandDiagnosticRecord {
  command: string;
  attempt: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  succeeded?: boolean;
}

export interface RecoveryDiagnosticRecord {
  checkpointId: string;
  attempt: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  success?: boolean;
  recoveredFiles?: string[];
  preservedFiles?: string[];
  error?: string;
}

export interface RunFilesSummary {
  modified: string[];
  created: string[];
  deleted: string[];
}

export interface RunSummary {
  runId: string;
  parentRunId?: string;
  resumeDepth?: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  finalStatus: AgentRunStatus | "interrupted";
  cwd: string;
  userRequestSummary: string;
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
  failureReason?: string;
  failureCode?: string;
  cancellationReason?: string;
  planId?: string;
  planStatus?: import("../planning/types.js").PlanStatus;
  totalPlanSteps?: number;
  completedPlanSteps?: number;
  failedPlanStep?: string;
  skippedPlanSteps?: number;
  currentPlanStep?: number;
  replanCount?: number;
  parentPlanId?: string;
  replanDepth?: number;
  replanReason?: string;
  replanTimestamp?: number;
  planInvalidationReason?: string;
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
  checkpointsCreated?: number;
  checkpointsConsumed?: number;
  checkpointsExpired?: number;
  checkpointsInvalidated?: number;
  handoffCount?: number;
  handoffAttempts?: number;
  handoffApprovals?: number;
  handoffRejections?: number;
  handoffInvalidations?: number;
  handoffBlockedCount?: number;
  handoffBlocks?: number;
  approvalWaitDurationMs?: number;
  lastHandoffStatus?: import("../planning/types.js").ExecutionHandoffStatus;
  lastHandoffReason?: string;
  lastHandoffDurationMs?: number;
  lastHandoffCheckpointId?: string;
}

export interface RunDiagnosticsManagerOptions {
  maxRetainedRuns?: number;
  maxEventsPerRun?: number;
}

export interface RunDiagnosticsManager {
  startRun(params: {
    runId: string;
    cwd: string;
    userRequest: string;
    activeSkills?: string[];
    riskLevel?: TaskRiskLevel;
    riskReasons?: string[];
    parentRunId?: string;
    resumeDepth?: number;
    requiresCheckpoint?: boolean;
    requiresExplicitApproval?: boolean;
    maxVerificationAttempts?: number;
    maxRecoveryAttempts?: number;
    checkpointId?: string;
  }): void;

  recordStateChange(runId: string, transition: AgentRunTransition): void;
  recordPlan(runId: string, plan: import("../planning/types.js").TaskPlan): void;
  updatePlanStep(
    runId: string,
    stepId: string,
    status: import("../planning/types.js").PlanStepStatus,
    error?: string
  ): void;
  recordFeedback(
    runId: string,
    feedback: import("../planning/types.js").ExecutionFeedback
  ): void;
  recordStepRetry(runId: string, stepId: string, attempt: number): void;
  recordPlanAdaptation(
    runId: string,
    reason: string,
    affectedSteps: string[]
  ): void;
  recordDecisionRequest(
    runId: string,
    request: import("../planning/types.js").ExecutionDecisionRequest
  ): void;
  recordDecisionResolution(
    runId: string,
    result: import("../planning/types.js").ExecutionDecisionResult
  ): void;
  recordResumeStart(
    runId: string,
    planId: string,
    stepId: string,
    stepOrder: number
  ): void;
  recordReconciliationStart(runId: string, reconciliationId: string): void;
  recordReconciliationResult(
    runId: string,
    result: import("../planning/types.js").FinalReconciliationResult
  ): void;
  recordRecoveryAssessment(
    runId: string,
    assessment: import("../planning/types.js").ExecutionRecoveryAssessment
  ): void;
  recordRecoveryResult(
    runId: string,
    result: import("../planning/types.js").ExecutionRecoveryResult
  ): void;
  recordContinuationResult(
    runId: string,
    result: import("../planning/types.js").RecoveryContinuationResult
  ): void;
  recordCheckpointRecord(
    runId: string,
    record: import("../checkpoints/types.js").CheckpointRecord
  ): void;
  recordHandoffResult(
    runId: string,
    result: import("../planning/types.js").ExecutionHandoffResult
  ): void;
  recordToolStart(runId: string, toolName: string, callId: string, targetPath?: string): void;
  recordToolComplete(
    runId: string,
    callId: string,
    success: boolean,
    errorCode?: string,
    permissionOutcome?: "allowed" | "denied" | "requires_approval" | "approved"
  ): void;
  recordVerificationStart(runId: string, command: string, attempt: number): void;
  recordVerificationComplete(
    runId: string,
    command: string,
    attempt: number,
    succeeded: boolean,
    exitCode?: number | null,
    timedOut?: boolean
  ): void;
  recordRecoveryStart(runId: string, checkpointId: string, attempt: number): void;
  recordRecoveryComplete(
    runId: string,
    checkpointId: string,
    attempt: number,
    success: boolean,
    recoveredFiles?: string[],
    preservedFiles?: string[],
    error?: string
  ): void;
  recordFileChange(
    runId: string,
    filePath: string,
    operation: "added" | "modified" | "deleted"
  ): void;
  recordCheckpointId(runId: string, checkpointId: string): void;
  recordSkills(runId: string, skills: string[]): void;

  completeRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    failureReason?: string,
    failureCode?: string
  ): RunSummary | undefined;

  getRunSummary(runId: string): RunSummary | undefined;
  getRunEvents(runId: string): AgentEvent[] | undefined;
  listRuns(): RunSummary[];
  getLatestRunSummary(): RunSummary | undefined;
  recordEvent(runId: string, event: AgentEvent): void;
  clear(): void;
}
