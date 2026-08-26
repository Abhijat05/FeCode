import type { TaskRiskLevel } from "../policy/types.js";

export type PlanStepType =
  | "inspect"
  | "analyze"
  | "modify"
  | "configure"
  | "test"
  | "verify";

export type PlanStatus =
  | "draft"
  | "ready"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded"
  | "blocked";

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

export interface PlanRisk {
  level: TaskRiskLevel;
  category: string;
  description: string;
  mitigation?: string;
}

export interface SuggestedCheckpoint {
  name: string;
  reason: string;
  timing: "before_mutation" | "after_mutation" | "manual";
  checkpointId?: string;
}

export type ExecutionIntentType =
  | "inspect_file"
  | "inspect_directory"
  | "search_code"
  | "modify_file"
  | "create_file"
  | "delete_file"
  | "execute_command"
  | "run_tests"
  | "verify_changes";

export interface ExecutionIntent {
  type: ExecutionIntentType;
  target?: string;
  reason: string;
  expectedChange?: string;
  requiresApproval: boolean;
  estimatedRisk: TaskRiskLevel;
  command?: string;
}

export interface PlanStep {
  stepId: string;
  order: number;
  title: string;
  objective: string;
  type: PlanStepType;
  dependencies: string[];
  expectedFiles?: string[];
  expectedTools?: string[];
  riskLevel: TaskRiskLevel;
  verificationRequired: boolean;
  status: PlanStepStatus;
  intent?: ExecutionIntent;
  error?: string;
}

export interface TaskPlan {
  planId: string;
  runId: string;
  createdAt: number;
  userRequestSummary: string;
  objective: string;
  assumptions?: string[];
  steps: PlanStep[];
  risks: PlanRisk[];
  checkpoints?: SuggestedCheckpoint[];
  verificationStrategy?: string[];
  status: PlanStatus;
  currentStepIndex?: number;
  replanCount?: number;
  invalidationReason?: string;
  parentPlanId?: string;
  rootPlanId?: string;
  replanDepth?: number;
  replanReason?: string;
}

export interface PlanSummary {
  planId: string;
  status: PlanStatus;
  objective: string;
  totalSteps: number;
  completedSteps: number;
  failedStep?: string;
  currentStep?: number;
  replanCount?: number;
  highestRisk: TaskRiskLevel;
  requiresApproval: boolean;
  invalidationReason?: string;
  parentPlanId?: string;
  replanDepth?: number;
  replanReason?: string;
}

export interface CreatePlanParams {
  runId: string;
  userMessage: string;
  cwd: string;
  activeSkills?: string[];
  authoritativeRisk?: TaskRiskLevel;
  affectedFiles?: string[];
}

export interface ReplanParams extends CreatePlanParams {
  reason: string;
}

export interface TaskPlanner {
  createPlan(params: CreatePlanParams): Promise<TaskPlan> | TaskPlan;
  replan(oldPlan: TaskPlan, params: ReplanParams): Promise<TaskPlan> | TaskPlan;
}

export type PlanExecutionStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";

export interface PlanVerificationResult {
  stepId: string;
  command: string;
  succeeded: boolean;
  success?: boolean;
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  timedOut?: boolean;
  failureReason?: string;
  planId?: string;
}

export interface PlanStepExecutionResult {
  stepId: string;
  status: PlanStepStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  executionIntent?: ExecutionIntent;
  toolCalls?: Array<{
    toolName: string;
    success: boolean;
    durationMs?: number;
    error?: string;
  }>;
  verification?: PlanVerificationResult;
  failureReason?: string;
}

export interface PlanExecutionResult {
  planId: string;
  status: PlanExecutionStatus;
  completedSteps: string[];
  failedStep?: string;
  skippedSteps: string[];
  verificationResults: PlanVerificationResult[];
  failureReason?: string;
  durationMs?: number;
  stepResults: PlanStepExecutionResult[];
}

export interface PlanStalenessResult {
  stale: boolean;
  reason?: string;
  affectedStep?: string;
  timestamp: number;
}

export interface PlanExecutorContext {
  runId: string;
  cwd: string;
  signal?: AbortSignal;
  initialFingerprint?: import("../history/types.js").WorkspaceFingerprint;
  initialGitBranch?: string;
  affectedFiles?: string[];
  emitRunEvents?: boolean;
  onStateTransition?: (
    to: import("../run/types.js").AgentRunStatus,
    reason: string
  ) => AsyncIterable<import("../index.js").AgentEvent>;
}

export interface PlanExecutorOptions {
  registry: import("@fecode/models").ToolRegistry;
  executor: import("@fecode/models").ToolExecutor;
  permissionManager: import("@fecode/models").PermissionManager;
  approvalResolver?: import("@fecode/models").ApprovalResolver;
  executionPolicy: import("../policy/types.js").ExecutionPolicy;
  checkpointManager?: import("../checkpoints/types.js").CheckpointManager;
  commandExecutor?: import("../commands/types.js").CommandExecutor;
  diagnosticsManager?: import("../diagnostics/types.js").RunDiagnosticsManager;
  safeEditValidator?: import("../editing/validator.js").SafeEditValidator;
  gitRepository?: import("../git/types.js").GitRepository;
  maxVerificationAttempts?: number;
  feedbackManager?: ExecutionFeedbackManager;
  retryPolicy?: StepRetryPolicy;
  reconciler?: FinalWorkspaceReconciler;
  reconciliationPolicy?: FinalReconciliationPolicy;
}

export interface PlanExecutor {
  executePlan(
    plan: TaskPlan,
    context: PlanExecutorContext,
    options?: { isResume?: boolean; resumedFromStepId?: string }
  ): AsyncIterable<import("../index.js").AgentEvent>;
  resumePlan?(
    plan: TaskPlan,
    context: PlanExecutorContext,
    options?: { resumedFromStepId?: string }
  ): AsyncIterable<import("../index.js").AgentEvent>;
}

export type ReplanReason =
  | "stale_workspace"
  | "branch_changed"
  | "file_changed"
  | "configuration_changed"
  | "dependency_changed"
  | "step_failed"
  | "verification_failed"
  | "user_requested"
  | "plan_invalidated";

export interface ReplanRequest {
  runId: string;
  previousPlanId: string;
  reason: ReplanReason | string;
  explanation?: string;
  failedStepId?: string;
  cwd: string;
  userRequest: string;
  currentWorkspaceFingerprint?: import("../history/types.js").WorkspaceFingerprint;
  requestedBy: "user";
}

export interface ReplanAssessment {
  eligible: boolean;
  reason: ReplanReason | string;
  explanation?: string;
  previousPlanId: string;
  affectedStepId?: string;
  workspaceChanged: boolean;
  workspaceDiffReasons?: string[];
  riskChanged: boolean;
  planStale: boolean;
  requiresUserConfirmation: boolean;
  replanDepth: number;
  maxReplanDepth: number;
  isLimitReached: boolean;
  currentFingerprint?: import("../history/types.js").WorkspaceFingerprint;
  reassessedRisk?: import("../policy/types.js").TaskRiskAssessment;
  reassessedSkills?: string[];
  previousPlan?: TaskPlan;
}

export interface ReplanResult {
  status: "created" | "rejected" | "limit_reached" | "failed";
  previousPlanId: string;
  newPlanId?: string;
  newPlan?: TaskPlan;
  reason: string;
  createdAt: number;
  replanDepth?: number;
  assessment?: ReplanAssessment;
}

export interface ReplanManagerOptions {
  planner: TaskPlanner;
  executionPolicy: import("../policy/types.js").ExecutionPolicy;
  gitRepository?: import("../git/types.js").GitRepository;
  skillRegistry?: import("../skills/types.js").SkillRegistry;
  activationPolicy?: import("../skills/activation.js").SkillActivationPolicy;
  projectContext?: import("../project/types.js").ProjectContext;
  historyStore?: import("../history/types.js").RunHistoryStore;
  diagnosticsManager?: import("../diagnostics/types.js").RunDiagnosticsManager;
  maxReplanDepth?: number;
}

export interface ReplanManager {
  registerPlan(plan: TaskPlan): void;
  getPlan(planId: string): Promise<TaskPlan | null>;
  assessReplanning(request: ReplanRequest): Promise<ReplanAssessment>;
  prepareReplan(
    planIdOrRunId: string,
    options: {
      cwd: string;
      userRequest?: string;
      reason?: ReplanReason | string;
      explanation?: string;
      failedStepId?: string;
    }
  ): Promise<ReplanAssessment>;
  executeReplan(request: ReplanRequest): Promise<ReplanResult>;
  getPlanHistory(planId: string): Promise<TaskPlan[]>;
}

export type ExecutionFeedbackKind =
  | "step_completed"
  | "step_failed"
  | "verification_failed"
  | "workspace_drift"
  | "dependency_changed"
  | "configuration_changed"
  | "unexpected_file_change"
  | "tool_failure"
  | "command_failure";

export type ExecutionFeedbackSeverity = "info" | "warning" | "blocking";

export type ExecutionFeedbackAction =
  | "continue"
  | "retry"
  | "inspect"
  | "replan"
  | "cancel";

export interface ExecutionFeedback {
  feedbackId: string;
  runId: string;
  planId: string;
  stepId?: string;
  kind: ExecutionFeedbackKind;
  severity: ExecutionFeedbackSeverity;
  summary: string;
  details?: string;
  detectedAt: number;
  requiresReplanning: boolean;
  requiresUserConfirmation: boolean;
  recommendedAction: ExecutionFeedbackAction;
}

export interface PlanAdaptationAssessment {
  planId: string;
  assessedAt: number;
  canContinue: boolean;
  canRetry: boolean;
  canAdapt: boolean;
  feedback: ExecutionFeedback[];
  affectedSteps: string[];
  currentRiskLevel: TaskRiskLevel;
  requiresUserConfirmation: boolean;
  recommendedAction: ExecutionFeedbackAction;
}

export interface ExecutionFeedbackInput {
  feedbackId?: string;
  runId: string;
  planId: string;
  stepId?: string;
  kind: ExecutionFeedbackKind;
  severity?: ExecutionFeedbackSeverity;
  summary: string;
  details?: string;
  detectedAt?: number;
  requiresReplanning?: boolean;
  requiresUserConfirmation?: boolean;
  recommendedAction?: ExecutionFeedbackAction;
}

export interface ExecutionFeedbackManager {
  recordFeedback(feedback: ExecutionFeedbackInput): ExecutionFeedback;
  getFeedback(runIdOrPlanId: string): ExecutionFeedback[];
  getPlanFeedback(planId: string): ExecutionFeedback[];
  assessPlanAdaptation(
    plan: TaskPlan,
    context?: { cwd?: string; riskLevel?: TaskRiskLevel }
  ): PlanAdaptationAssessment;
  clearFeedback(runIdOrPlanId?: string): void;
}

export interface StepRetryPolicy {
  maxAttempts: number;
  retryableFailures: ExecutionFeedbackKind[];
  requiresFreshRiskAssessment: boolean;
  requiresFreshPermission: boolean;
  canRetry(
    step: PlanStep,
    attemptCount: number,
    failureKind: ExecutionFeedbackKind,
    opType?: string
  ): boolean;
  getRemainingAttempts(stepId: string, currentAttempts: number): number;
}

export type ExecutionDecision = "continue" | "replan" | "cancel";

export interface ExecutionDecisionRequest {
  decisionId: string;
  runId: string;
  planId: string;
  blockedStepId: string;
  affectedStepIds: string[];
  reason: string;
  requestedAt: number;
  allowedDecisions: ExecutionDecision[];
  defaultDecision: ExecutionDecision;
}

export interface ExecutionDecisionResult {
  decisionId: string;
  decision: ExecutionDecision;
  accepted: boolean;
  resultingPlanId?: string;
  resultingRunId?: string;
  resumedStepId?: string;
  resumedStepOrder?: number;
  cancelled: boolean;
  reason?: string;
  resolvedAt: number;
}

export interface ExecutionDecisionManager {
  createDecisionRequest(params: {
    decisionId?: string;
    runId: string;
    planId: string;
    blockedStepId: string;
    affectedStepIds: string[];
    reason: string;
    allowedDecisions?: ExecutionDecision[];
    defaultDecision?: ExecutionDecision;
    requestedAt?: number;
  }): ExecutionDecisionRequest;

  resolveDecision(
    requestOrDecisionId: string | ExecutionDecisionRequest,
    decision: ExecutionDecision | string,
    options?: {
      cwd?: string;
      userRequest?: string;
      plan?: TaskPlan;
    }
  ): Promise<ExecutionDecisionResult>;

  getActiveRequest(planIdOrRunId: string): ExecutionDecisionRequest | undefined;
  getDecisionResult(decisionId: string): ExecutionDecisionResult | undefined;
  clear(planIdOrRunId?: string): void;
}

export type FinalReconciliationStatus =
  | "pending"
  | "checking"
  | "consistent"
  | "inconsistent"
  | "failed";

export interface FinalReconciliationResult {
  reconciliationId: string;
  runId: string;
  planId: string;
  status: FinalReconciliationStatus;
  checkedAt: number;
  expectedFiles: string[];
  modifiedFiles: string[];
  unexpectedFiles: string[];
  missingFiles: string[];
  changedFiles: string[];
  branchChanged: boolean;
  workspaceChanged: boolean;
  verificationPassed: boolean;
  consistent: boolean;
  failureReason?: string;
}

export interface FinalReconciliationPolicy {
  required: boolean;
  allowUnexpectedFiles?: boolean;
  allowBranchChange?: boolean;
  allowMissingExpectedFiles?: boolean;
}

export interface FinalWorkspaceReconciler {
  reconcile(params: {
    runId: string;
    plan: TaskPlan;
    cwd: string;
    initialFingerprint?: import("../history/types.js").WorkspaceFingerprint;
    gitRepository?: import("../git/types.js").GitRepository;
    verificationPassed?: boolean;
    policy?: FinalReconciliationPolicy;
  }): Promise<FinalReconciliationResult>;
}

export type RecoveryStrategy =
  | "recheck"
  | "repair"
  | "rollback"
  | "replan"
  | "cancel";

export interface RepairAction {
  target: string;
  operation: "create_file" | "modify_file" | "restore_file";
  reason: string;
  content?: string;
}

export interface ExecutionRecoveryRequest {
  recoveryId: string;
  runId: string;
  planId: string;
  requestedBy: "user";
  strategy: RecoveryStrategy;
  reason: string;
  affectedSteps: string[];
  affectedFiles: string[];
  workspaceFingerprint?: import("../history/types.js").WorkspaceFingerprint;
  requestedAt: number;
  parentRecoveryId?: string;
  rootRecoveryId?: string;
  recoveryDepth?: number;
}

export interface ExecutionRecoveryAssessment {
  eligible: boolean;
  strategy: RecoveryStrategy;
  riskLevel: import("../policy/types.js").TaskRiskLevel;
  riskReasons: string[];
  workspaceDrift: boolean;
  affectedSteps: string[];
  affectedFiles: string[];
  requiresExplicitApproval: boolean;
  reason: string;
  recoveryDepth: number;
  maxRecoveryDepth: number;
  isLimitReached: boolean;
  checkpointId?: string;
  repairActions?: RepairAction[];
  reconciliationResult?: FinalReconciliationResult;
}

export type RecoveryOutcomeStatus =
  | "recovered"
  | "recovered_with_changes"
  | "still_blocked"
  | "failed"
  | "cancelled";

export interface FailedRecoveryAction {
  action: RepairAction;
  error: string;
}

export interface ExecutionRecoveryResult {
  recoveryId: string;
  runId: string;
  planId: string;
  strategy: RecoveryStrategy;
  status: RecoveryOutcomeStatus | "completed" | "blocked";
  outcome?: RecoveryOutcomeStatus;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  affectedSteps: string[];
  completedRecoveryActions?: RepairAction[];
  failedRecoveryActions?: FailedRecoveryAction[];
  repairedFiles: string[];
  verificationResult?: PlanVerificationResult;
  reconciliationResult?: FinalReconciliationResult;
  workspaceConsistent?: boolean;
  finalPlanStatus?: PlanStatus;
  failureReason?: string;
  blockingReasons?: string[];
  cancellationReason?: string;
  replanResult?: ReplanResult;
  parentRecoveryId?: string;
  rootRecoveryId?: string;
  recoveryDepth: number;
}

export interface ExecutionRecoveryOptions {
  cwd: string;
  userRequest?: string;
  strategy?: RecoveryStrategy;
  reason?: string;
  affectedSteps?: string[];
  affectedFiles?: string[];
  parentRecoveryId?: string;
  approved?: boolean;
  signal?: AbortSignal;
  reconciliationResult?: FinalReconciliationResult;
}

export interface ExecutionRecoveryManagerOptions {
  executionPolicy: import("../policy/types.js").ExecutionPolicy;
  permissionManager?: import("@fecode/models").PermissionManager;
  approvalResolver?: import("@fecode/models").ApprovalResolver;
  reconciler: FinalWorkspaceReconciler;
  replanManager?: ReplanManager;
  checkpointManager?: import("../checkpoints/types.js").CheckpointManager;
  checkpointRecoveryManager?: import("../recovery/types.js").RecoveryManager;
  commandExecutor?: import("../commands/types.js").CommandExecutor;
  diagnosticsManager?: import("../diagnostics/types.js").RunDiagnosticsManager;
  historyStore?: import("../history/types.js").RunHistoryStore;
  gitRepository?: import("../git/types.js").GitRepository;
  maxRecoveryDepth?: number;
}

export interface ExecutionRecoveryManager {
  assessRecovery(
    plan: TaskPlan,
    options: ExecutionRecoveryOptions
  ): Promise<ExecutionRecoveryAssessment>;

  executeRecovery(
    plan: TaskPlan,
    assessment: ExecutionRecoveryAssessment,
    options: ExecutionRecoveryOptions
  ): AsyncIterable<import("../index.js").AgentEvent>;

  getRecoveryHistory(planId: string): ExecutionRecoveryResult[];
  getRecoveryLineage(recoveryId: string): ExecutionRecoveryResult[];
}

export type RecoveryContinuationDecision = "continue" | "replan" | "cancel";

export type ContinuationStatus =
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "rejected";

export interface RecoveryContinuationPreparation {
  eligible: boolean;
  canContinue: boolean;
  planId: string;
  runId: string;
  recoveryOutcome: RecoveryOutcomeStatus;
  remainingSteps: PlanStep[];
  completedSteps: PlanStep[];
  skippedSteps: PlanStep[];
  reassessedRisk?: import("../policy/types.js").TaskRiskAssessment;
  reassessedSkills?: string[];
  reconciliationConsistent: boolean;
  reconciliationFailureReason?: string;
  staleness?: PlanStalenessResult;
  reason?: string;
  requiresExplicitApproval: boolean;
}

export interface RecoveryContinuationRequest {
  runId: string;
  planId: string;
  decision: RecoveryContinuationDecision;
  cwd: string;
  reason?: string;
  approved?: boolean;
  signal?: AbortSignal;
}

export interface RecoveryContinuationResult {
  continuationId: string;
  runId: string;
  planId: string;
  recoveryOutcome: RecoveryOutcomeStatus;
  decision: RecoveryContinuationDecision;
  status: ContinuationStatus;
  startingPlanStatus: PlanStatus;
  finalPlanStatus: PlanStatus;
  resumedStepIds: string[];
  completedStepIds: string[];
  skippedStepIds: string[];
  failureReason?: string;
  blockingReasons?: string[];
  cancellationReason?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  replanResult?: ReplanResult;
}

export interface RecoveryContinuationManagerOptions {
  planExecutor: PlanExecutor;
  reconciler: FinalWorkspaceReconciler;
  executionPolicy: import("../policy/types.js").ExecutionPolicy;
  replanManager?: ReplanManager;
  skillRegistry?: import("../skills/types.js").SkillRegistry;
  activationPolicy?: import("../skills/activation.js").SkillActivationPolicy;
  permissionManager?: import("@fecode/models").PermissionManager;
  approvalResolver?: import("@fecode/models").ApprovalResolver;
  checkpointManager?: import("../checkpoints/types.js").CheckpointManager;
  diagnosticsManager?: import("../diagnostics/types.js").RunDiagnosticsManager;
  historyStore?: import("../history/types.js").RunHistoryStore;
  gitRepository?: import("../git/types.js").GitRepository;
}

export interface RecoveryContinuationManager {
  prepareContinuation(
    plan: TaskPlan,
    options: {
      cwd: string;
      recoveryResult?: ExecutionRecoveryResult;
      recoveryOutcome?: RecoveryOutcomeStatus;
      userRequest?: string;
    }
  ): Promise<RecoveryContinuationPreparation>;

  executeContinuation(
    plan: TaskPlan,
    preparation: RecoveryContinuationPreparation,
    request: RecoveryContinuationRequest
  ): AsyncIterable<import("../index.js").AgentEvent>;

  getContinuationHistory(planId: string): RecoveryContinuationResult[];
}
