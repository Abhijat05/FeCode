import type { TaskRiskLevel } from "../policy/types.js";
import type { UIState, UIStatus, ApprovalType, TimelineItem } from "./types.js";

export interface ApplicationShellProps {
  status: UIStatus;
  cwd: string;
  runId?: string;
  gitBranch: string | null;
  isGitDirty: boolean;
  skillsCount: number;
  riskLevel: TaskRiskLevel;
  hasPendingApproval: boolean;
  hasError: boolean;
}

export interface WorkspacePanelProps {
  cwd: string;
  gitBranch: string | null;
  isGitDirty: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
  hasDrift: boolean;
  driftReason?: string;
}

export interface TaskComposerProps {
  userRequest?: string;
  canSubmit: boolean;
  isExecuting: boolean;
  activeSkills: string[];
}

export interface RunStatusProps {
  status: UIStatus;
  lifecycleState: string;
  runId?: string;
  durationMs?: number;
  error?: string;
  hasFailed: boolean;
  isCompleted: boolean;
}

export interface PlanStepViewModel {
  stepId: string;
  order: number;
  title: string;
  objective: string;
  status: string;
  riskLevel: TaskRiskLevel;
  durationMs?: number;
  error?: string;
  isCurrent: boolean;
}

export interface PlanViewerProps {
  hasPlan: boolean;
  planId?: string;
  objective?: string;
  userRequestSummary?: string;
  status?: string;
  steps: PlanStepViewModel[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
}

export interface ExecutionTimelineProps {
  items: TimelineItem[];
  totalEvents: number;
  hasActiveEvent: boolean;
}

export interface ApprovalPromptProps {
  approvalId: string;
  type: ApprovalType;
  typeLabel: string;
  title: string;
  reason: string;
  riskLevel: TaskRiskLevel;
  affectedTargets: string[];
  checkpointId?: string;
  expiresAt?: number;
  defaultDecision: "reject" | "cancel";
}

export interface RiskBannerProps {
  riskLevel: TaskRiskLevel;
  isElevatedOrCritical: boolean;
  badgeColor: "green" | "yellow" | "red" | "magenta";
  title: string;
}

export interface CheckpointStatusProps {
  checkpointId?: string;
  status: string;
  affectedTargets: string[];
}

export interface ToolActivityProps {
  callId: string;
  toolName: string;
  target?: string;
  startedAt: number;
  elapsedMs: number;
}

export interface VerificationStatusProps {
  stepId: string;
  command: string;
  startedAt: number;
  output?: string;
  exitCode?: number;
  succeeded?: boolean;
}

export interface RecoveryStatusProps {
  recoveryId: string;
  strategy: string;
  startedAt: number;
  outcome?: string;
}

export interface DiagnosticsPanelProps {
  runId?: string;
  status?: string;
  handoffCount?: number;
  handoffApprovals?: number;
  handoffRejections?: number;
  handoffInvalidations?: number;
}

// ---------------------------------------------------------------------------
// Selector Helper Functions (Pure Projections from UIState)
// ---------------------------------------------------------------------------

export function selectApplicationShellProps(state: UIState): ApplicationShellProps {
  return {
    status: state.status,
    cwd: state.cwd,
    runId: state.runId,
    gitBranch: state.workspace?.gitBranch || null,
    isGitDirty: state.workspace?.isGitDirty || false,
    skillsCount: state.skills.length,
    riskLevel: state.riskLevel,
    hasPendingApproval: state.pendingApproval !== undefined,
    hasError: state.error !== undefined
  };
}

export function selectWorkspacePanelProps(state: UIState): WorkspacePanelProps {
  return {
    cwd: state.cwd,
    gitBranch: state.workspace?.gitBranch || null,
    isGitDirty: state.workspace?.isGitDirty || false,
    modifiedFiles: state.workspace?.modifiedFiles ? [...state.workspace.modifiedFiles] : [],
    untrackedFiles: state.workspace?.untrackedFiles ? [...state.workspace.untrackedFiles] : [],
    stagedFiles: state.workspace?.stagedFiles ? [...state.workspace.stagedFiles] : [],
    hasDrift: state.workspace?.hasDrift || false,
    driftReason: state.workspace?.driftReason
  };
}

export function selectTaskComposerProps(state: UIState): TaskComposerProps {
  const isExecuting =
    state.status === "executing" ||
    state.status === "planning" ||
    state.status === "verifying" ||
    state.status === "recovering";
  return {
    userRequest: state.userRequest,
    canSubmit: !isExecuting && state.pendingApproval === undefined,
    isExecuting,
    activeSkills: [...state.skills]
  };
}

export function selectRunStatusProps(state: UIState): RunStatusProps {
  return {
    status: state.status,
    lifecycleState: state.lifecycleState,
    runId: state.runId,
    error: state.error,
    hasFailed: state.status === "failed",
    isCompleted: state.status === "completed"
  };
}

export function selectPlanViewerProps(state: UIState): PlanViewerProps {
  if (!state.activePlan) {
    return {
      hasPlan: false,
      steps: [],
      completedCount: 0,
      totalCount: 0,
      progressPercent: 0
    };
  }

  const steps: PlanStepViewModel[] = state.activePlan.steps.map((step) => ({
    stepId: step.stepId,
    order: step.order,
    title: step.title,
    objective: step.objective,
    status: step.status,
    riskLevel: step.riskLevel,
    durationMs: step.durationMs,
    error: step.error,
    isCurrent: step.stepId === state.activeStepId
  }));

  const totalCount = state.activePlan.totalStepsCount || steps.length;
  const completedCount = state.activePlan.completedStepsCount || 0;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    hasPlan: true,
    planId: state.activePlan.planId,
    objective: state.activePlan.objective,
    userRequestSummary: state.activePlan.userRequestSummary,
    status: state.activePlan.status,
    steps,
    completedCount,
    totalCount,
    progressPercent
  };
}

export function selectExecutionTimelineProps(state: UIState): ExecutionTimelineProps {
  return {
    items: [...state.timeline],
    totalEvents: state.timeline.length,
    hasActiveEvent: state.timeline.some((item) => item.status === "running")
  };
}

export function selectApprovalPromptProps(
  state: UIState
): ApprovalPromptProps | undefined {
  const app = state.pendingApproval;
  if (!app) return undefined;

  let typeLabel = "Approval Required";
  switch (app.type) {
    case "plan":
      typeLabel = "Plan Approval";
      break;
    case "step_checkpoint":
      typeLabel = "Mutation Checkpoint Approval";
      break;
    case "tool_permission":
      typeLabel = "Tool Permission Request";
      break;
    case "recovery":
      typeLabel = "Recovery Strategy Decision";
      break;
    case "continuation":
      typeLabel = "Execution Continuation Approval";
      break;
    case "replan":
      typeLabel = "Replanning Proposal Approval";
      break;
  }

  return {
    approvalId: app.approvalId,
    type: app.type,
    typeLabel,
    title: `[${typeLabel}] ${app.toolName || app.stepId || app.planId || ""}`,
    reason: app.reason,
    riskLevel: app.riskLevel,
    affectedTargets: [...app.affectedTargets],
    checkpointId: app.checkpointId,
    expiresAt: app.expiresAt,
    defaultDecision: app.defaultDecision
  };
}

export function selectRiskBannerProps(state: UIState): RiskBannerProps {
  const level = state.riskLevel || "low";
  let badgeColor: "green" | "yellow" | "red" | "magenta" = "green";
  if (level === "normal") badgeColor = "yellow";
  if (level === "elevated") badgeColor = "red";
  if (level === "critical") badgeColor = "magenta";

  return {
    riskLevel: level,
    isElevatedOrCritical: level === "elevated" || level === "critical",
    badgeColor,
    title: `Risk Assessment: ${level.toUpperCase()}`
  };
}

export function selectCheckpointStatusProps(
  state: UIState
): CheckpointStatusProps | undefined {
  if (!state.pendingApproval?.checkpointId) return undefined;
  return {
    checkpointId: state.pendingApproval.checkpointId,
    status: state.status,
    affectedTargets: [...state.pendingApproval.affectedTargets]
  };
}

export function selectToolActivityProps(
  state: UIState
): ToolActivityProps | undefined {
  if (!state.activeTool) return undefined;
  return {
    callId: state.activeTool.callId,
    toolName: state.activeTool.toolName,
    target: state.activeTool.target,
    startedAt: state.activeTool.startedAt,
    elapsedMs: Math.max(0, Date.now() - state.activeTool.startedAt)
  };
}

export function selectVerificationStatusProps(
  state: UIState
): VerificationStatusProps | undefined {
  if (!state.activeVerification) return undefined;
  return {
    stepId: state.activeVerification.stepId,
    command: state.activeVerification.command,
    startedAt: state.activeVerification.startedAt,
    output: state.activeVerification.output,
    exitCode: state.activeVerification.exitCode,
    succeeded: state.activeVerification.succeeded
  };
}

export function selectRecoveryStatusProps(
  state: UIState
): RecoveryStatusProps | undefined {
  if (!state.activeRecovery) return undefined;
  return {
    recoveryId: state.activeRecovery.recoveryId,
    strategy: state.activeRecovery.strategy,
    startedAt: state.activeRecovery.startedAt,
    outcome: state.activeRecovery.outcome
  };
}

export function selectDiagnosticsPanelProps(
  state: UIState
): DiagnosticsPanelProps {
  const diag = state.diagnostics;
  return {
    runId: state.runId,
    status: state.status,
    handoffCount: diag?.handoffCount,
    handoffApprovals: diag?.handoffApprovals,
    handoffRejections: diag?.handoffRejections,
    handoffInvalidations: diag?.handoffInvalidations
  };
}
