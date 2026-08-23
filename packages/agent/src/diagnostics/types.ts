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
