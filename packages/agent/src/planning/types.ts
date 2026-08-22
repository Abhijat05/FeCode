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
  | "superseded";

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
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  timedOut?: boolean;
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
}

export interface PlanExecutor {
  executePlan(
    plan: TaskPlan,
    context: PlanExecutorContext
  ): AsyncIterable<import("../index.js").AgentEvent>;
}
