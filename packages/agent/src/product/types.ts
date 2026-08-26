import type { ModelProvider, ApprovalDecision } from "@fecode/models";
import type { TaskRiskLevel, TaskRiskAssessment, TaskRiskContext } from "../policy/types.js";
import type { AgentRunStatus } from "../run/types.js";
import type { PlanStatus, PlanStepStatus, PlanStepType } from "../planning/types.js";
import type { RunSummary } from "../diagnostics/types.js";
import type { DurableRunRecord } from "../history/types.js";
import type { AgentEvent } from "../index.js";

export type UIStatus =
  | "idle"
  | "planning"
  | "awaiting_plan_approval"
  | "executing"
  | "awaiting_step_approval"
  | "verifying"
  | "blocked"
  | "recovering"
  | "awaiting_recovery_decision"
  | "awaiting_continuation"
  | "awaiting_replan"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalType =
  | "plan"
  | "step_checkpoint"
  | "tool_permission"
  | "recovery"
  | "continuation"
  | "replan";

export interface UIApprovalModel {
  approvalId: string;
  type: ApprovalType;
  runId: string;
  planId?: string;
  stepId?: string;
  toolName?: string;
  riskLevel: TaskRiskLevel;
  reason: string;
  affectedTargets: string[];
  checkpointId?: string;
  workspaceDriftDetected?: boolean;
  expiresAt?: number;
  defaultDecision: "reject" | "cancel";
}

export interface UIWorkspaceFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  additions?: number;
  deletions?: number;
}

export interface WorkspaceSnapshot {
  cwd: string;
  gitBranch: string | null;
  isGitDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
  stagedFiles: string[];
  recentChanges: UIWorkspaceFileChange[];
  hasDrift: boolean;
  driftReason?: string;
}

export interface StepSnapshot {
  stepId: string;
  order: number;
  title: string;
  objective: string;
  type: PlanStepType;
  dependencies: string[];
  riskLevel: TaskRiskLevel;
  status: PlanStepStatus;
  verificationRequired: boolean;
  expectedFiles?: string[];
  error?: string;
  durationMs?: number;
}

export interface PlanSnapshot {
  planId: string;
  runId: string;
  objective: string;
  userRequestSummary: string;
  status: PlanStatus;
  steps: StepSnapshot[];
  createdAt: number;
  completedStepsCount: number;
  totalStepsCount: number;
}

export interface RunSnapshot {
  runId: string;
  sessionId: string;
  userRequest: string;
  status: UIStatus;
  lifecycleState: AgentRunStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  activePlan?: PlanSnapshot;
}

export interface TimelineItem {
  id: string;
  type:
    | "run_event"
    | "plan_step"
    | "tool_call"
    | "verification"
    | "recovery"
    | "approval"
    | "retry"
    | "error";
  timestamp: number;
  title: string;
  description?: string;
  status?:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "skipped"
    | "approved"
    | "rejected"
    | "cancelled";
  metadata?: Record<string, unknown>;
}

export interface ActiveToolActivity {
  callId: string;
  toolName: string;
  target?: string;
  startedAt: number;
  permissionCategory?: string;
}

export interface ActiveVerificationActivity {
  stepId: string;
  command: string;
  startedAt: number;
  succeeded?: boolean;
  output?: string;
  exitCode?: number;
}

export interface ActiveRecoveryActivity {
  recoveryId: string;
  strategy: string;
  startedAt: number;
  outcome?: string;
  reason?: string;
}

export interface UIMessage {
  id: string;
  sender: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
}

export interface UIState {
  status: UIStatus;
  lifecycleState: AgentRunStatus;
  runId?: string;
  sessionId: string;
  cwd: string;
  userRequest?: string;
  activePlan?: PlanSnapshot;
  activeStepId?: string;
  activeTool?: ActiveToolActivity;
  activeVerification?: ActiveVerificationActivity;
  activeRecovery?: ActiveRecoveryActivity;
  pendingApproval?: UIApprovalModel;
  timeline: TimelineItem[];
  messages: UIMessage[];
  skills: string[];
  riskLevel: TaskRiskLevel;
  error?: string;
  workspace?: WorkspaceSnapshot;
  diagnostics?: RunSummary;
}

export type ProductEvent =
  | { type: "ui_state_changed"; state: UIState }
  | {
      type: "run_status_changed";
      runId: string;
      status: UIStatus;
      previousStatus: UIStatus;
    }
  | { type: "plan_updated"; plan: PlanSnapshot }
  | { type: "approval_requested"; approval: UIApprovalModel }
  | { type: "tool_activity_changed"; activity?: ActiveToolActivity }
  | { type: "text_chunk"; text: string }
  | { type: "raw_agent_event"; event: AgentEvent };

export interface TaskSubmissionRequest {
  message: string;
  cwd: string;
  sessionId?: string;
  provider?: ModelProvider;
  signal?: AbortSignal;
  parentRunId?: string;
  resumeRunId?: string;
}

export type ProductErrorCategory =
  | "RUNTIME_ERROR"
  | "EXECUTION_FAILURE"
  | "PERMISSION_DENIED"
  | "APPROVAL_REJECTED"
  | "WORKSPACE_DRIFT"
  | "PLAN_FAILURE"
  | "RECOVERY_FAILURE"
  | "UI_ERROR"
  | "CONFIG_ERROR";

export interface ProductError {
  category: ProductErrorCategory;
  message: string;
  details?: string;
  recoverable: boolean;
  stepId?: string;
  runId?: string;
  timestamp: number;
}

export interface ProductRuntime {
  // Task Submission & Controls
  submitTask(request: TaskSubmissionRequest): AsyncIterable<ProductEvent>;
  cancelCurrentRun(): Promise<void>;

  // Interactive Resolvers
  resolveApproval(decision: ApprovalDecision): Promise<void>;

  // Read-Only Snapshots & State Queries
  getUIState(): UIState;
  getCurrentRunSnapshot(): RunSnapshot | undefined;
  getActivePlanSnapshot(): PlanSnapshot | undefined;
  getRiskAssessment(context?: TaskRiskContext): TaskRiskAssessment;
  getActiveSkills(): string[];
  getWorkspaceSnapshot(): Promise<WorkspaceSnapshot>;

  // Diagnostics & History (Project Isolated)
  getDiagnosticsSummary(runId?: string): RunSummary | undefined;
  getHistoricalRuns(options?: { limit?: number }): Promise<DurableRunRecord[]>;
  getHistoricalRun(runId: string): Promise<DurableRunRecord | null>;
  getRunLineage(runId: string): Promise<DurableRunRecord[]>;

  // Lifecycle & Event Subscriptions
  subscribe(
    listener: (state: UIState, event?: ProductEvent) => void
  ): () => void;
}
