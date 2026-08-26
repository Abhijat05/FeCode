import {
  DefaultPermissionManager,
  DefaultToolExecutor,
  DefaultToolRegistry
} from "@fecode/models";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  PermissionManager,
  TokenUsage,
  ToolCall,
  ToolExecutor,
  ToolRegistry,
  ToolResult
} from "@fecode/models";
import type { Agent, AgentEvent, AgentInput } from "./index.js";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";
import type { CommandResult } from "./commands/types.js";
import type { ProjectContext } from "./project/types.js";
import type { SkillRegistry } from "./skills/types.js";
import { SkillActivationPolicy } from "./skills/activation.js";
import { composeSystemPrompt } from "./skills/composer.js";
import type { TokenOptimizer } from "./optimization/types.js";
import { DefaultTokenOptimizer } from "./optimization/defaultOptimizer.js";
import type { AgentPolicyRegistry } from "./policies/types.js";
import { DefaultAgentPolicyRegistry } from "./policies/registry.js";
import type { TaskPlan as LegacyTaskPlan } from "./tasks/types.js";
import { failTaskStep } from "./tasks/taskPlan.js";
import { SafeEditValidator } from "./editing/validator.js";
import {
  calculateDiffStats,
  createChangeReview,
  type ChangeReviewFile
} from "./editing/changeReview.js";
import type { ProductRuntime } from "./product/types.js";
import { DefaultProductRuntime } from "./product/productRuntime.js";

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentState {
  sessionId: string;
  status: AgentStatus;
  messages: ModelMessage[];
  tokenUsage?: TokenUsage;
  verificationAttempts?: number;
  activePlan?: LegacyTaskPlan;
}

import type { RepositoryExplorer, ExplorationResult } from "./exploration/types.js";
import type { CodeContextSelector, CodeContextResult } from "./context/types.js";
import type { AgentExecutionStrategy } from "./strategy/types.js";
import { DefaultAgentExecutionStrategy } from "./strategy/executionStrategy.js";
import { TaskCompletionTracker } from "./completion/tracker.js";
import type { TaskCompletionSummary } from "./completion/types.js";
import type { PersistedSessionData } from "./session/types.js";
import type { GitRepository } from "./git/types.js";
import { DefaultGitRepository } from "./git/gitRepository.js";
import { computeChangeAttribution } from "./git/attribution.js";
import type { CheckpointManager, CheckpointStore } from "./checkpoints/types.js";
import { DefaultCheckpointManager } from "./checkpoints/checkpointManager.js";
import type { RecoveryManager } from "./recovery/types.js";
import { DefaultRecoveryManager } from "./recovery/recoveryManager.js";
import type { ExecutionPolicy, TaskRiskContext, TaskRiskAssessment } from "./policy/types.js";
import { DefaultTaskRiskPolicy } from "./policy/taskRiskPolicy.js";
import type {
  AgentRunStateMachine,
  AgentRunStatus,
  AgentRunTransitionResult
} from "./run/types.js";
import { DefaultAgentRunStateMachine } from "./run/stateMachine.js";
import type {
  RunDiagnosticsManager,
  RunSummary
} from "./diagnostics/types.js";
import { DefaultRunDiagnosticsManager } from "./diagnostics/runDiagnosticsManager.js";
import type {
  DurableRunRecord,
  ResumeManager,
  ResumePreparation,
  ResumeRunOptions,
  RunHistoryStore,
  WorkspaceFingerprint
} from "./history/types.js";
import { DefaultRunHistoryStore } from "./history/runHistoryStore.js";
import { DefaultResumeManager } from "./history/resumeManager.js";
import { getProjectIdentifier } from "./history/projectIdentifier.js";
import { captureWorkspaceFingerprint } from "./history/workspaceFingerprint.js";
import type {
  TaskPlan,
  TaskPlanner,
  PlanExecutor,
  ReplanManager,
  ReplanAssessment,
  ReplanRequest,
  ReplanResult,
  ExecutionFeedback,
  ExecutionFeedbackManager,
  PlanAdaptationAssessment,
  StepRetryPolicy,
  ExecutionDecision,
  ExecutionDecisionRequest,
  ExecutionDecisionResult,
  ExecutionDecisionManager,
  FinalWorkspaceReconciler,
  FinalReconciliationPolicy,
  ExecutionRecoveryManager,
  ExecutionRecoveryAssessment,
  ExecutionRecoveryOptions,
  ExecutionRecoveryResult,
  RecoveryOutcomeStatus,
  RecoveryContinuationManager,
  RecoveryContinuationPreparation,
  RecoveryContinuationRequest,
  ExecutionHandoffManager
} from "./planning/types.js";
import { DefaultTaskPlanner } from "./planning/planner.js";
import { DefaultPlanExecutor } from "./planning/executor.js";
import { DefaultReplanManager } from "./planning/replanManager.js";
import { DefaultExecutionFeedbackManager } from "./planning/executionFeedback.js";
import { DefaultStepRetryPolicy } from "./planning/retryPolicy.js";
import { DefaultExecutionDecisionManager } from "./planning/decisionManager.js";
import { DefaultFinalWorkspaceReconciler } from "./planning/reconciliation.js";
import { DefaultExecutionRecoveryManager } from "./planning/executionRecoveryManager.js";
import { DefaultRecoveryContinuationManager } from "./planning/continuationManager.js";
import { DefaultExecutionHandoffManager } from "./planning/handoffManager.js";
import {
  transitionPlanStatus,
  completePlanStep,
  failPlanStep
} from "./planning/taskPlan.js";

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  sessionId?: string;
  registry?: ToolRegistry;
  executor?: ToolExecutor;
  permissionManager?: PermissionManager;
  approvalResolver?: ApprovalResolver;
  maxVerificationAttempts?: number;
  projectContext?: ProjectContext;
  skillRegistry?: SkillRegistry;
  activationPolicy?: SkillActivationPolicy;
  tokenOptimizer?: TokenOptimizer;
  policyRegistry?: AgentPolicyRegistry;
  repositoryExplorer?: RepositoryExplorer;
  codeContextSelector?: CodeContextSelector;
  executionStrategy?: AgentExecutionStrategy;
  gitRepository?: GitRepository;
  checkpointManager?: CheckpointManager;
  checkpointStore?: CheckpointStore;
  recoveryManager?: RecoveryManager;
  executionPolicy?: ExecutionPolicy;
  diagnosticsManager?: RunDiagnosticsManager;
  historyStore?: RunHistoryStore;
  historyStorageDir?: string;
  resumeManager?: ResumeManager;
  planner?: TaskPlanner;
  planExecutor?: PlanExecutor;
  replanManager?: ReplanManager;
  feedbackManager?: ExecutionFeedbackManager;
  retryPolicy?: StepRetryPolicy;
  decisionManager?: ExecutionDecisionManager;
  reconciler?: FinalWorkspaceReconciler;
  reconciliationPolicy?: FinalReconciliationPolicy;
  executionRecoveryManager?: ExecutionRecoveryManager;
  recoveryContinuationManager?: RecoveryContinuationManager;
  handoffManager?: ExecutionHandoffManager;
  maxRecoveryDepth?: number;
  maxReplanDepth?: number;
  maxRetainedRuns?: number;
  emitRunEvents?: boolean;
  maxIdenticalToolCalls?: number;
  maxTurns?: number;
}

export class AgentRuntime implements Agent {
  private readonly modelProvider: ModelProvider;
  private readonly systemPrompt: string;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly permissionManager: PermissionManager;
  private readonly approvalResolver?: ApprovalResolver;
  private readonly maxVerificationAttempts: number;
  private readonly maxIdenticalToolCalls: number;
  private readonly maxTurns: number;
  private readonly emitRunEvents: boolean;
  private readonly projectContext?: ProjectContext;
  private readonly skillRegistry?: SkillRegistry;
  private readonly activationPolicy?: SkillActivationPolicy;
  private readonly tokenOptimizer: TokenOptimizer;
  private readonly policyRegistry: AgentPolicyRegistry;
  private readonly repositoryExplorer?: RepositoryExplorer;
  private readonly codeContextSelector?: CodeContextSelector;
  private readonly executionStrategy: AgentExecutionStrategy;
  private readonly gitRepository?: GitRepository;
  private readonly checkpointManager: CheckpointManager;
  private readonly recoveryManager: RecoveryManager;
  private readonly executionPolicy: ExecutionPolicy;
  private readonly diagnosticsManager: RunDiagnosticsManager;
  private readonly historyStore: RunHistoryStore;
  private readonly resumeManager: ResumeManager;
  private readonly planner: TaskPlanner;
  private readonly planExecutor: PlanExecutor;
  private readonly replanManager: ReplanManager;
  private readonly feedbackManager: ExecutionFeedbackManager;
  private readonly retryPolicy: StepRetryPolicy;
  private readonly decisionManager: ExecutionDecisionManager;
  private readonly reconciler: FinalWorkspaceReconciler;
  private readonly reconciliationPolicy: FinalReconciliationPolicy;
  private readonly executionRecoveryManager: ExecutionRecoveryManager;
  private readonly recoveryContinuationManager: RecoveryContinuationManager;
  private readonly handoffManager: ExecutionHandoffManager;
  private readonly maxReplanDepth: number;
  private readonly completionTracker: TaskCompletionTracker = new TaskCompletionTracker();
  private readonly safeEditValidator: SafeEditValidator = new SafeEditValidator();
  private currentRunStateMachine?: AgentRunStateMachine;
  private currentParentRunId?: string;
  private currentResumeDepth?: number;
  private currentProjectId?: string;
  private currentWorkspaceFingerprint?: WorkspaceFingerprint;
  private currentPlan?: TaskPlan;
  private state: AgentState;
  private activeController: AbortController | null = null;
  private lastToolCallKey: string | null = null;
  private consecutiveToolCallCount: number = 0;

  constructor(modelProvider: ModelProvider, options: AgentRuntimeOptions = {}) {
    this.modelProvider = modelProvider;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.registry = options.registry || new DefaultToolRegistry();
    this.executor =
      options.executor || new DefaultToolExecutor(this.registry);
    this.permissionManager =
      options.permissionManager || new DefaultPermissionManager();
    this.approvalResolver = options.approvalResolver;
    this.maxVerificationAttempts = options.maxVerificationAttempts ?? 3;
    this.maxIdenticalToolCalls = options.maxIdenticalToolCalls ?? 3;
    this.maxTurns = options.maxTurns ?? 50;
    this.emitRunEvents = options.emitRunEvents ?? false;
    this.projectContext = options.projectContext;
    this.skillRegistry = options.skillRegistry;
    this.activationPolicy = options.activationPolicy;
    this.tokenOptimizer = options.tokenOptimizer || new DefaultTokenOptimizer();
    this.policyRegistry = options.policyRegistry || new DefaultAgentPolicyRegistry();
    this.repositoryExplorer = options.repositoryExplorer;
    this.codeContextSelector = options.codeContextSelector;
    this.executionStrategy = options.executionStrategy || new DefaultAgentExecutionStrategy();
    this.gitRepository = options.gitRepository || new DefaultGitRepository();
    this.checkpointManager =
      options.checkpointManager ||
      new DefaultCheckpointManager(options.checkpointStore, this.gitRepository);
    this.recoveryManager =
      options.recoveryManager ||
      new DefaultRecoveryManager(options.checkpointStore, this.gitRepository);
    this.executionPolicy =
      options.executionPolicy || new DefaultTaskRiskPolicy();
    this.diagnosticsManager =
      options.diagnosticsManager ||
      new DefaultRunDiagnosticsManager({
        maxRetainedRuns: options.maxRetainedRuns
      });
    this.historyStore =
      options.historyStore ||
      new DefaultRunHistoryStore({ storageDir: options.historyStorageDir });
    this.planner = options.planner || new DefaultTaskPlanner();
    this.feedbackManager =
      options.feedbackManager || new DefaultExecutionFeedbackManager();
    this.retryPolicy = options.retryPolicy || new DefaultStepRetryPolicy();
    this.decisionManager =
      options.decisionManager || new DefaultExecutionDecisionManager();
    this.reconciler =
      options.reconciler || new DefaultFinalWorkspaceReconciler();
    this.reconciliationPolicy = options.reconciliationPolicy || {
      required: true
    };
    this.handoffManager =
      options.handoffManager ||
      new DefaultExecutionHandoffManager({
        registry: this.registry,
        executor: this.executor,
        permissionManager: this.permissionManager,
        approvalResolver: this.approvalResolver,
        executionPolicy: this.executionPolicy,
        checkpointManager: this.checkpointManager,
        diagnosticsManager: this.diagnosticsManager,
        gitRepository: this.gitRepository
      });
    this.planExecutor =
      options.planExecutor ||
      new DefaultPlanExecutor({
        registry: this.registry,
        executor: this.executor,
        permissionManager: this.permissionManager,
        approvalResolver: this.approvalResolver,
        executionPolicy: this.executionPolicy,
        checkpointManager: this.checkpointManager,
        diagnosticsManager: this.diagnosticsManager,
        safeEditValidator: this.safeEditValidator,
        gitRepository: this.gitRepository,
        maxVerificationAttempts: this.maxVerificationAttempts,
        feedbackManager: this.feedbackManager,
        retryPolicy: this.retryPolicy,
        reconciler: this.reconciler,
        reconciliationPolicy: this.reconciliationPolicy,
        handoffManager: this.handoffManager
      });
    this.maxReplanDepth = options.maxReplanDepth ?? 5;
    this.replanManager =
      options.replanManager ||
      new DefaultReplanManager({
        planner: this.planner,
        executionPolicy: this.executionPolicy,
        gitRepository: this.gitRepository,
        skillRegistry: this.skillRegistry,
        activationPolicy: this.activationPolicy,
        projectContext: this.projectContext,
        historyStore: this.historyStore,
        diagnosticsManager: this.diagnosticsManager,
        maxReplanDepth: this.maxReplanDepth
      });
    this.resumeManager =
      options.resumeManager ||
      new DefaultResumeManager({
        historyStore: this.historyStore,
        gitRepository: this.gitRepository,
        executionPolicy: this.executionPolicy,
        skillRegistry: this.skillRegistry,
        activationPolicy: this.activationPolicy,
        projectContext: this.projectContext
      });
    this.executionRecoveryManager =
      options.executionRecoveryManager ||
      new DefaultExecutionRecoveryManager({
        executionPolicy: this.executionPolicy,
        permissionManager: this.permissionManager,
        approvalResolver: this.approvalResolver,
        reconciler: this.reconciler,
        replanManager: this.replanManager,
        checkpointManager: this.checkpointManager,
        checkpointRecoveryManager: this.recoveryManager,
        diagnosticsManager: this.diagnosticsManager,
        historyStore: this.historyStore,
        gitRepository: this.gitRepository,
        maxRecoveryDepth: options.maxRecoveryDepth
      });
    this.recoveryContinuationManager =
      options.recoveryContinuationManager ||
      new DefaultRecoveryContinuationManager({
        planExecutor: this.planExecutor,
        reconciler: this.reconciler,
        executionPolicy: this.executionPolicy,
        replanManager: this.replanManager,
        skillRegistry: this.skillRegistry,
        activationPolicy: this.activationPolicy,
        permissionManager: this.permissionManager,
        approvalResolver: this.approvalResolver,
        checkpointManager: this.checkpointManager,
        diagnosticsManager: this.diagnosticsManager,
        historyStore: this.historyStore,
        gitRepository: this.gitRepository
      });

    this.state = {
      sessionId:
        options.sessionId ||
        `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      status: "idle",
      messages: [],
      verificationAttempts: 0
    };
  }

  public getRegistry(): ToolRegistry {
    return this.registry;
  }

  public getCompletionSummary(): TaskCompletionSummary {
    return this.completionTracker.getSummary();
  }

  public getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  public getRecoveryManager(): RecoveryManager {
    return this.recoveryManager;
  }

  public getExecutionPolicy(): ExecutionPolicy {
    return this.executionPolicy;
  }

  public getHistoryStore(): RunHistoryStore {
    return this.historyStore;
  }

  public getResumeManager(): ResumeManager {
    return this.resumeManager;
  }

  public getPlanner(): TaskPlanner {
    return this.planner;
  }

  public getPlanExecutor(): PlanExecutor {
    return this.planExecutor;
  }

  public getReplanManager(): ReplanManager {
    return this.replanManager;
  }

  public getExecutionFeedbackManager(): ExecutionFeedbackManager {
    return this.feedbackManager;
  }

  public getRetryPolicy(): StepRetryPolicy {
    return this.retryPolicy;
  }

  public getExecutionDecisionManager(): ExecutionDecisionManager {
    return this.decisionManager;
  }

  public getHandoffManager(): ExecutionHandoffManager {
    return this.handoffManager;
  }

  public async resolveExecutionDecision(
    requestOrDecisionId: string | ExecutionDecisionRequest,
    decision: ExecutionDecision | string,
    options: {
      cwd?: string;
      userRequest?: string;
    } = {}
  ): Promise<ExecutionDecisionResult> {
    const result = await this.decisionManager.resolveDecision(
      requestOrDecisionId,
      decision,
      {
        cwd: options.cwd || process.cwd(),
        userRequest: options.userRequest || this.currentPlan?.userRequestSummary,
        plan: this.currentPlan
      }
    );

    const runId = result.resultingRunId || this.state.sessionId;
    this.diagnosticsManager.recordDecisionResolution(runId, result);

    return result;
  }

  public getExecutionFeedback(runIdOrPlanId?: string): ExecutionFeedback[] {
    const targetId =
      runIdOrPlanId || this.currentPlan?.planId || this.state.sessionId;
    return this.feedbackManager.getFeedback(targetId);
  }

  public getPlanAdaptationAssessment(
    planId?: string
  ): PlanAdaptationAssessment | undefined {
    const plan = planId ? undefined : this.currentPlan;
    if (!plan) return undefined;
    return this.feedbackManager.assessPlanAdaptation(plan);
  }

  public getTaskPlan(): TaskPlan | undefined {
    return this.currentPlan;
  }

  public async prepareReplan(
    planIdOrRunId?: string,
    options: {
      cwd?: string;
      userRequest?: string;
      reason?: import("./planning/types.js").ReplanReason | string;
      explanation?: string;
      failedStepId?: string;
    } = {}
  ): Promise<ReplanAssessment> {
    const targetId = planIdOrRunId || this.currentPlan?.planId;
    if (!targetId) {
      throw new Error("No active or historical plan specified for replanning.");
    }
    const cwd = options.cwd || process.cwd();
    return this.replanManager.prepareReplan(targetId, {
      cwd,
      userRequest: options.userRequest || this.currentPlan?.userRequestSummary,
      reason: options.reason || "user_requested",
      explanation: options.explanation,
      failedStepId: options.failedStepId
    });
  }

  public async executeReplan(
    request: ReplanRequest
  ): Promise<ReplanResult> {
    const result = await this.replanManager.executeReplan(request);
    if (result.status === "created" && result.newPlan) {
      this.currentPlan = result.newPlan;
    }
    return result;
  }

  public getReconciler(): FinalWorkspaceReconciler {
    return this.reconciler;
  }

  public getExecutionRecoveryManager(): ExecutionRecoveryManager {
    return this.executionRecoveryManager;
  }

  public async assessExecutionRecovery(
    planIdOrRunId?: string,
    options: ExecutionRecoveryOptions = { cwd: process.cwd() }
  ): Promise<ExecutionRecoveryAssessment> {
    const targetPlan = planIdOrRunId
      ? await this.replanManager.getPlan(planIdOrRunId)
      : this.currentPlan;
    if (!targetPlan) {
      throw new Error(
        "No active or historical plan specified for recovery assessment."
      );
    }
    return this.executionRecoveryManager.assessRecovery(targetPlan, options);
  }

  public async *executeExecutionRecovery(
    assessment: ExecutionRecoveryAssessment,
    options: ExecutionRecoveryOptions = { cwd: process.cwd() }
  ): AsyncIterable<AgentEvent> {
    const targetPlan = this.currentPlan;
    if (!targetPlan) {
      throw new Error("No plan available for recovery execution.");
    }

    for await (const ev of this.executionRecoveryManager.executeRecovery(
      targetPlan,
      assessment,
      options
    )) {
      yield ev;

      if (ev.type === "recovery_started" && "strategy" in ev) {
        this.currentRunStateMachine?.transition(
          "recovering",
          `Execution recovery started: ${ev.strategy}`
        );
      } else if (ev.type === "recovery_outcome_determined") {
        this.diagnosticsManager.recordRecoveryResult(targetPlan.runId, ev.result);
        if (
          ev.outcome === "recovered" ||
          ev.outcome === "recovered_with_changes"
        ) {
          if (ev.result.finalPlanStatus === "completed") {
            this.currentRunStateMachine?.transition(
              "completed",
              "Execution recovery completed and workspace reconciled"
            );
          } else {
            this.currentRunStateMachine?.transition(
              "idle",
              "Execution recovery succeeded; plan ready for continuation"
            );
          }
        } else if (ev.outcome === "still_blocked") {
          this.currentRunStateMachine?.transition(
            "idle",
            `Execution recovery still blocked: ${ev.result.blockingReasons?.join("; ") || "inconsistent workspace"}`
          );
        } else if (ev.outcome === "failed") {
          this.currentRunStateMachine?.transition(
            "failed",
            `Execution recovery failed: ${ev.result.failureReason || "unknown error"}`
          );
        } else if (ev.outcome === "cancelled") {
          this.currentRunStateMachine?.transition(
            "cancelled",
            `Execution recovery cancelled: ${ev.result.cancellationReason || "user request"}`
          );
        }
      } else if (ev.type === "recovery_completed" && "result" in ev) {
        this.diagnosticsManager.recordRecoveryResult(targetPlan.runId, ev.result);
      } else if (ev.type === "recovery_failed") {
        this.diagnosticsManager.recordRecoveryResult(targetPlan.runId, ev.result);
      }
    }
  }

  public getRecoveryContinuationManager(): RecoveryContinuationManager {
    return this.recoveryContinuationManager;
  }

  public async prepareRecoveryContinuation(
    options: {
      cwd?: string;
      recoveryResult?: ExecutionRecoveryResult;
      recoveryOutcome?: RecoveryOutcomeStatus;
      userRequest?: string;
    } = {}
  ): Promise<RecoveryContinuationPreparation> {
    const targetPlan = this.currentPlan;
    if (!targetPlan) {
      throw new Error("No plan available for recovery continuation.");
    }
    const targetCwd = options.cwd || process.cwd();
    return this.recoveryContinuationManager.prepareContinuation(targetPlan, {
      cwd: targetCwd,
      recoveryResult: options.recoveryResult,
      recoveryOutcome: options.recoveryOutcome,
      userRequest: options.userRequest
    });
  }

  public async *continueRecoveredPlan(
    preparation: RecoveryContinuationPreparation,
    request: RecoveryContinuationRequest
  ): AsyncIterable<AgentEvent> {
    const targetPlan = this.currentPlan;
    if (!targetPlan) {
      throw new Error("No plan available for recovery continuation.");
    }

    for await (const ev of this.recoveryContinuationManager.executeContinuation(
      targetPlan,
      preparation,
      request
    )) {
      yield ev;

      if (ev.type === "recovery_continuation_started") {
        this.currentRunStateMachine?.transition(
          "executing",
          `Recovery continuation started for plan ${ev.planId}`
        );
      } else if (ev.type === "recovery_continuation_completed") {
        this.diagnosticsManager.recordContinuationResult(
          targetPlan.runId,
          ev.result
        );
        if (ev.result.finalPlanStatus === "completed") {
          this.currentRunStateMachine?.transition(
            "completed",
            "Recovery continuation completed all plan steps"
          );
        } else {
          this.currentRunStateMachine?.transition(
            "idle",
            `Recovery continuation finished with plan status ${ev.result.finalPlanStatus}`
          );
        }
      } else if (ev.type === "recovery_continuation_blocked") {
        this.diagnosticsManager.recordContinuationResult(
          targetPlan.runId,
          ev.result
        );
        this.currentRunStateMachine?.transition(
          "idle",
          `Recovery continuation blocked: ${ev.blockingReasons?.join("; ")}`
        );
      } else if (ev.type === "recovery_continuation_failed") {
        this.diagnosticsManager.recordContinuationResult(
          targetPlan.runId,
          ev.result
        );
        this.currentRunStateMachine?.transition(
          "failed",
          `Recovery continuation failed: ${ev.reason}`
        );
      } else if (ev.type === "recovery_continuation_cancelled") {
        this.diagnosticsManager.recordContinuationResult(
          targetPlan.runId,
          ev.result
        );
        this.currentRunStateMachine?.transition(
          "cancelled",
          `Recovery continuation cancelled: ${ev.reason}`
        );
      }
    }
  }

  public async *executeApprovedPlan(
    plan?: TaskPlan,
    options: { cwd?: string } = {}
  ): AsyncIterable<AgentEvent> {
    const targetPlan = plan || this.currentPlan;
    if (!targetPlan) {
      throw new Error("No execution plan available to execute.");
    }
    const runId = targetPlan.runId || `run-${Date.now()}`;
    const targetCwd = options.cwd || process.cwd();

    for await (const ev of this.planExecutor.executePlan(targetPlan, {
      runId,
      cwd: targetCwd,
      signal: this.activeController?.signal,
      initialFingerprint: this.currentWorkspaceFingerprint,
      emitRunEvents: this.emitRunEvents
    })) {
      yield ev;

      if (ev.type === "final_reconciliation_started") {
        this.currentRunStateMachine?.transition(
          "reconciling",
          "Final workspace reconciliation started"
        );
      } else if (ev.type === "final_reconciliation_completed") {
        this.currentRunStateMachine?.transition(
          "completed",
          "Final workspace reconciliation completed successfully"
        );
      } else if (ev.type === "plan_blocked") {
        const req = this.decisionManager.createDecisionRequest({
          runId,
          planId: ev.planId,
          blockedStepId: ev.blockedStepId || "",
          affectedStepIds: ev.affectedSteps,
          reason: ev.reason
        });
        this.diagnosticsManager.recordDecisionRequest(runId, req);
        yield {
          type: "execution_decision_requested",
          request: req,
          timestamp: Date.now()
        };
      }
    }
  }

  public async *resumeExecution(
    planId?: string,
    options: { cwd?: string } = {}
  ): AsyncIterable<AgentEvent> {
    const targetPlan = planId ? await this.replanManager.getPlan(planId) : this.currentPlan;
    if (!targetPlan) {
      throw new Error("No execution plan available to resume.");
    }
    const runId = targetPlan.runId || `run-${Date.now()}`;
    const targetCwd = options.cwd || process.cwd();

    for await (const ev of this.planExecutor.executePlan(
      targetPlan,
      {
        runId,
        cwd: targetCwd,
        signal: this.activeController?.signal,
        initialFingerprint: this.currentWorkspaceFingerprint,
        emitRunEvents: this.emitRunEvents
      },
      { isResume: true }
    )) {
      yield ev;

      if (ev.type === "final_reconciliation_started") {
        this.currentRunStateMachine?.transition(
          "reconciling",
          "Final workspace reconciliation started"
        );
      } else if (ev.type === "final_reconciliation_completed") {
        this.currentRunStateMachine?.transition(
          "completed",
          "Final workspace reconciliation completed successfully"
        );
      } else if (ev.type === "plan_blocked") {
        const req = this.decisionManager.createDecisionRequest({
          runId,
          planId: ev.planId,
          blockedStepId: ev.blockedStepId || "",
          affectedStepIds: ev.affectedSteps,
          reason: ev.reason
        });
        this.diagnosticsManager.recordDecisionRequest(runId, req);
        yield {
          type: "execution_decision_requested",
          request: req,
          timestamp: Date.now()
        };
      }
    }
  }

  public async prepareResume(
    runId: string,
    cwd: string
  ): Promise<ResumePreparation> {
    return this.resumeManager.prepareResume(runId, cwd);
  }

  public async *resumeRun(
    runId: string,
    options: ResumeRunOptions = {}
  ): AsyncIterable<AgentEvent> {
    const originalRun = await this.historyStore.getRun(runId);
    if (!originalRun) {
      throw new Error(`Run not found in history: ${runId}`);
    }

    const targetCwd = options.cwd || originalRun.cwd;
    const prep = await this.resumeManager.prepareResume(runId, targetCwd);

    if (!prep.canResume) {
      throw new Error(prep.explanation);
    }

    if (!options.approved) {
      throw new Error("Explicit user approval is required to resume a task.");
    }

    const resumeMessage = this.resumeManager.buildResumeContext(
      originalRun,
      prep
    );

    yield* this.run({
      message: resumeMessage,
      cwd: targetCwd,
      parentRunId: originalRun.runId,
      resumeDepth: prep.resumeDepth
    });
  }

  public async getHistoricalRun(
    runId: string
  ): Promise<DurableRunRecord | null> {
    return this.historyStore.getRun(runId);
  }

  public async getRunLineage(runId: string): Promise<DurableRunRecord[]> {
    return this.historyStore.getRunLineage(runId);
  }

  public async listHistoricalRuns(options?: {
    projectId?: string;
    limit?: number;
  }): Promise<DurableRunRecord[]> {
    return this.historyStore.listRuns(options);
  }

  public getRunStateMachine(): AgentRunStateMachine | undefined {
    return this.currentRunStateMachine;
  }

  public getRunSummary(runId?: string): RunSummary | undefined {
    if (runId) {
      return this.diagnosticsManager.getRunSummary(runId);
    }
    return this.diagnosticsManager.getLatestRunSummary();
  }

  public getRunEvents(runId?: string): AgentEvent[] | undefined {
    if (runId) {
      return this.diagnosticsManager.getRunEvents(runId);
    }
    const latest = this.diagnosticsManager.getLatestRunSummary();
    return latest ? this.diagnosticsManager.getRunEvents(latest.runId) : undefined;
  }

  public listRuns(): RunSummary[] {
    return this.diagnosticsManager.listRuns();
  }

  public getLatestRunSummary(): RunSummary | undefined {
    return this.diagnosticsManager.getLatestRunSummary();
  }

  public getDiagnosticsManager(): RunDiagnosticsManager {
    return this.diagnosticsManager;
  }

  public getGitRepository(): GitRepository | undefined {
    return this.gitRepository;
  }

  public getApprovalResolver(): ApprovalResolver | undefined {
    return this.approvalResolver;
  }

  public getProductRuntime(options?: {
    initialCwd?: string;
    initialSessionId?: string;
  }): ProductRuntime {
    return new DefaultProductRuntime({
      agentRuntime: this,
      gitRepository: this.gitRepository,
      approvalResolver: this.approvalResolver,
      initialCwd: options?.initialCwd,
      initialSessionId: options?.initialSessionId
    });
  }

  public assessTaskRisk(context: TaskRiskContext): TaskRiskAssessment {
    return this.executionPolicy.assess(context);
  }

  public getState(): AgentState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      tokenUsage: this.state.tokenUsage ? { ...this.state.tokenUsage } : undefined,
      activePlan: this.state.activePlan
        ? {
            ...this.state.activePlan,
            steps: this.state.activePlan.steps.map((s) => ({ ...s }))
          }
        : undefined
    };
  }

  public getPlan(): LegacyTaskPlan | undefined {
    return this.state.activePlan;
  }

  public setPlan(plan: LegacyTaskPlan): void {
    this.state.activePlan = plan;
  }

  public clear(): void {
    this.state.messages = [];
    this.state.activePlan = undefined;
    this.state.verificationAttempts = 0;
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.completionTracker.reset();
    this.state.status = "idle";
    if (this.repositoryExplorer) {
      this.repositoryExplorer.invalidate();
    }
    if (this.codeContextSelector) {
      this.codeContextSelector.invalidate();
    }
  }

  public restoreSession(data: PersistedSessionData): void {
    this.state.sessionId = data.sessionId;
    this.state.messages = [...(data.messages || [])];
    this.state.status =
      data.status === "completed"
        ? "completed"
        : data.status === "cancelled"
          ? "cancelled"
          : data.status === "blocked"
            ? "failed"
            : "idle";
    this.state.verificationAttempts = 0;
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.completionTracker.reset();
  }

  public transitionRunStateDirect(
    nextStatus: AgentRunStatus,
    reason: string
  ): AgentRunTransitionResult {
    if (!this.currentRunStateMachine) {
      return {
        success: false,
        from: "idle",
        to: nextStatus,
        reason,
        error: "No active run state machine"
      };
    }
    const res = this.currentRunStateMachine.transition(nextStatus, reason);
    if (res.success) {
      if (nextStatus === "completed") {
        this.state.status = "completed";
      } else if (nextStatus === "cancelled") {
        this.state.status = "cancelled";
      } else if (nextStatus === "failed") {
        this.state.status = "failed";
      } else {
        this.state.status = "running";
      }
    }
    return res;
  }

  private *transitionRunState(
    nextStatus: AgentRunStatus,
    reason: string
  ): Generator<AgentEvent, AgentRunTransitionResult, undefined> {
    if (!this.currentRunStateMachine) {
      return {
        success: false,
        from: "idle",
        to: nextStatus,
        reason,
        error: "No active run state machine"
      };
    }

    const runId = this.currentRunStateMachine.getContext().runId;
    const currentStatus = this.currentRunStateMachine.getState();
    const result = this.currentRunStateMachine.transition(nextStatus, reason);

    if (result.success) {
      if (nextStatus === "completed") {
        this.state.status = "completed";
      } else if (nextStatus === "cancelled") {
        this.state.status = "cancelled";
      } else if (nextStatus === "failed") {
        this.state.status = "failed";
      } else {
        this.state.status = "running";
      }

      const stateEv: AgentEvent = {
        type: "state_changed",
        runId,
        from: currentStatus,
        to: nextStatus,
        reason,
        timestamp: Date.now()
      };
      this.diagnosticsManager.recordStateChange(runId, {
        timestamp: Date.now(),
        from: currentStatus,
        to: nextStatus,
        reason
      });
      this.diagnosticsManager.recordEvent(runId, stateEv);

      if (this.emitRunEvents) {
        yield stateEv;
      }

      if (nextStatus === "completed") {
        this.diagnosticsManager.completeRun(runId, "completed");
        const termEv: AgentEvent = {
          type: "run_completed",
          runId
        };
        this.diagnosticsManager.recordEvent(runId, termEv);
        if (this.emitRunEvents) {
          yield termEv;
        }
      } else if (nextStatus === "failed") {
        this.diagnosticsManager.completeRun(runId, "failed", reason);
        const termEv: AgentEvent = {
          type: "run_failed",
          runId,
          error: reason
        };
        this.diagnosticsManager.recordEvent(runId, termEv);
        if (this.emitRunEvents) {
          yield termEv;
        }
      } else if (nextStatus === "cancelled") {
        this.diagnosticsManager.completeRun(runId, "cancelled", reason);
        const termEv: AgentEvent = {
          type: "run_cancelled",
          runId
        };
        this.diagnosticsManager.recordEvent(runId, termEv);
        if (this.emitRunEvents) {
          yield termEv;
        }
      }
    }

    return result;
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (input.sessionId && this.state.messages.length === 0) {
      this.state.sessionId = input.sessionId;
    }

    this.currentParentRunId = input.parentRunId;
    this.currentResumeDepth = input.resumeDepth;
    this.state.status = "running";
    this.activeController = new AbortController();
    this.completionTracker.reset();
    this.completionTracker.setRequest(input.message);
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.state.verificationAttempts = 0;

    const stateMachine = new DefaultAgentRunStateMachine({
      cwd: input.cwd,
      maxVerificationAttempts: this.maxVerificationAttempts
    });
    this.currentRunStateMachine = stateMachine;
    const runId = stateMachine.getContext().runId;

    if (this.gitRepository) {
      try {
        const isRepo = await this.gitRepository.isRepository(input.cwd);
        if (isRepo) {
          const baseline = await this.gitRepository.getSnapshot(input.cwd);
          this.completionTracker.setBaselineSnapshot(baseline);
          this.currentWorkspaceFingerprint = {
            capturedAt: Date.now(),
            gitBranch: baseline.branch || undefined,
            isGitDirty: baseline.files.length > 0
          };
        }
      } catch {
        // ignore git errors
      }
    }

    try {
      this.currentProjectId = await getProjectIdentifier(
        input.cwd,
        this.gitRepository
      );
      if (!this.currentWorkspaceFingerprint) {
        this.currentWorkspaceFingerprint = await captureWorkspaceFingerprint(
          input.cwd,
          undefined,
          this.gitRepository
        );
      }
    } catch {
      // Ignore
    }

    const initialRisk = this.executionPolicy.assess({
      userMessage: input.message,
      cwd: input.cwd,
      affectedFiles: [],
      operations: []
    });

    this.diagnosticsManager.startRun({
      runId,
      parentRunId: this.currentParentRunId,
      resumeDepth: this.currentResumeDepth,
      cwd: input.cwd,
      userRequest: input.message,
      riskLevel: initialRisk.level,
      riskReasons: initialRisk.reasons,
      requiresCheckpoint: initialRisk.requiresCheckpoint,
      requiresExplicitApproval: initialRisk.requiresExplicitApproval,
      maxVerificationAttempts: this.maxVerificationAttempts,
      maxRecoveryAttempts: 1
    });

    // Persist initial (interrupted) run record
    const initialSummary = this.diagnosticsManager.getRunSummary(runId);
    if (initialSummary) {
      try {
        await this.historyStore.saveRun(
          {
            ...initialSummary,
            finalStatus: "interrupted"
          },
          this.currentProjectId,
          this.currentWorkspaceFingerprint,
          this.currentParentRunId,
          this.currentResumeDepth
        );
      } catch {
        // Non-fatal persistence error
      }
    }

    const runStartedEv: AgentEvent = { type: "run_started", runId };
    this.diagnosticsManager.recordEvent(runId, runStartedEv);
    if (this.emitRunEvents) {
      yield runStartedEv;
    }

    yield* this.transitionRunState(
      "planning",
      "Task started and context initialized"
    );

    try {
      const activeSkillNames = this.skillRegistry
        ? this.skillRegistry.list().map((s) => s.name)
        : [];
      this.currentPlan = await this.planner.createPlan({
        runId,
        userMessage: input.message,
        cwd: input.cwd,
        activeSkills: activeSkillNames,
        authoritativeRisk: initialRisk.level,
        affectedFiles: []
      });
      if (this.currentPlan) {
        this.diagnosticsManager.recordPlan(runId, this.currentPlan);
        if (this.emitRunEvents) {
          yield { type: "plan_created", plan: this.currentPlan };
        }
      }
    } catch {
      // Non-fatal planning error
    }

    if (
      initialRisk.requiresCheckpoint &&
      this.checkpointManager &&
      !this.completionTracker.getSummary().checkpointId
    ) {
      try {
        const cpRes = await this.checkpointManager.create({
          cwd: input.cwd,
          taskId: this.state.sessionId,
          reason:
            initialRisk.reasons.join("; ") || "Elevated/Critical risk task",
          signal: this.activeController.signal
        });
        if (cpRes.success && cpRes.checkpoint) {
          this.completionTracker.setCheckpointId(cpRes.checkpoint.id);
        }
      } catch {
        // ignore checkpoint creation errors
      }
    }

    this.state.messages.push({
      role: "user",
      content: input.message
    });

    const decision = this.executionStrategy.decide(input.message, {
      projectProfile: this.projectContext?.profile,
      activePlan: this.state.activePlan,
      verificationAttempts: this.state.verificationAttempts
    });

    let explorationResult: ExplorationResult | undefined;
    if (decision.shouldExplore && this.repositoryExplorer) {
      try {
        explorationResult = await this.repositoryExplorer.explore(input.message, {
          cwd: input.cwd,
          projectProfile: this.projectContext?.profile,
          signal: this.activeController.signal
        });
      } catch {
        // ignore exploration errors
      }
    }

    let codeContext: CodeContextResult | undefined;
    if (decision.shouldSelectContext && this.codeContextSelector && explorationResult) {
      try {
        codeContext = await this.codeContextSelector.selectContext(
          explorationResult,
          input.message,
          {
            cwd: input.cwd,
            signal: this.activeController.signal
          }
        );
      } catch {
        // ignore selection error
      }
    }

    const policies = this.policyRegistry.list();
    let activeSystemPrompt = this.systemPrompt;
    if (this.skillRegistry && this.activationPolicy) {
      const activated = this.activationPolicy.activate(
        input.message,
        this.skillRegistry,
        this.projectContext
      );
      if (activated.skills.length > 0) {
        yield { type: "skills_activated", skills: activated.skills.map((s) => s.name) };
      }
      activeSystemPrompt = composeSystemPrompt({
        baseSystemPrompt: this.systemPrompt,
        policies,
        projectContext: this.projectContext,
        activeSkills: activated.skills,
        tokenOptimizer: this.tokenOptimizer,
        explorationResult,
        codeContext,
        strategyGuidance: decision.guidance
      });
    } else {
      activeSystemPrompt = composeSystemPrompt({
        baseSystemPrompt: this.systemPrompt,
        policies,
        projectContext: this.projectContext,
        activeSkills: [],
        explorationResult,
        codeContext,
        strategyGuidance: decision.guidance
      });
    }

    let turnCount = 0;
    try {
      while (turnCount < this.maxTurns) {
        turnCount++;
        if (this.activeController.signal.aborted) {
          throw new Error("Request aborted");
        }

        const registeredTools = this.registry.list();
        const toolDefinitions = registeredTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));

        const request: ModelRequest = {
          system: activeSystemPrompt,
          messages: [...this.state.messages],
          tools: toolDefinitions.length ? toolDefinitions : undefined
        };

        let accumulatedText = "";
        const toolCallsForTurn: ToolCall[] = [];
        let turnError: Error | null = null;

        const stream = this.modelProvider.generate(
          request,
          this.activeController.signal
        );

        for await (const event of stream) {
          if (event.type === "text_delta") {
            accumulatedText += event.content;
            yield { type: "text", content: event.content };
          } else if (event.type === "tool_call") {
            toolCallsForTurn.push(event.call);
            yield { type: "tool_call", call: event.call };
          } else if (event.type === "completed") {
            if (event.usage) {
              const currentUsage = this.state.tokenUsage || {};
              this.state.tokenUsage = {
                inputTokens:
                  (currentUsage.inputTokens || 0) +
                  (event.usage.inputTokens || 0),
                outputTokens:
                  (currentUsage.outputTokens || 0) +
                  (event.usage.outputTokens || 0),
                totalTokens:
                  (currentUsage.totalTokens || 0) +
                  (event.usage.totalTokens || 0)
              };
            }
          } else if (event.type === "error") {
            turnError = event.error;
            yield { type: "error", error: event.error };
            break;
          }
        }

        if (turnError) {
          const isCancelled =
            this.activeController.signal.aborted ||
            turnError.message.toLowerCase().includes("abort") ||
            turnError.message.toLowerCase().includes("cancel");
          this.state.status = isCancelled ? "cancelled" : "failed";
          break;
        }

        this.state.messages.push({
          role: "assistant",
          content: accumulatedText || undefined,
          toolCalls: toolCallsForTurn.length ? toolCallsForTurn : undefined
        });

        if (toolCallsForTurn.length === 0) {
          if (
            this.currentRunStateMachine &&
            !this.currentRunStateMachine.isTerminal()
          ) {
            yield* this.transitionRunState(
              "completed",
              "Task execution finished"
            );
          }

          if (this.gitRepository) {
            try {
              const isRepo = await this.gitRepository.isRepository(input.cwd);
              if (isRepo) {
                const postTask = await this.gitRepository.getSnapshot(input.cwd);
                this.completionTracker.setPostTaskSnapshot(postTask);

                const baseline = this.completionTracker.getBaselineSnapshot() || null;
                const currentSum = this.completionTracker.getSummary();
                const fecodePaths = currentSum.changeSet
                  ? currentSum.changeSet.files.map((f) => f.path)
                  : currentSum.completedFiles;

                const attribution = computeChangeAttribution(
                  baseline,
                  postTask,
                  fecodePaths
                );
                this.completionTracker.setGitAttribution(attribution);
              }
            } catch {
              // ignore git errors
            }
          }

          const summary = this.completionTracker.evaluateCompletion({
            activePlan: this.state.activePlan
          });
          if (
            this.state.activePlan !== undefined ||
            summary.completedFiles.length > 0 ||
            summary.verifiedCommands.length > 0 ||
            summary.completedRequirements.length > 0 ||
            summary.status === "blocked"
          ) {
            yield { type: "task_summary", summary };
          }
          yield { type: "done" };
          break;
        }

        if (
          this.currentRunStateMachine &&
          this.currentRunStateMachine.getState() === "planning"
        ) {
          yield* this.transitionRunState(
            "executing",
            "Tool execution started"
          );
        }

        for (const call of toolCallsForTurn) {
          if (
            this.currentRunStateMachine?.isTerminal() ||
            this.activeController.signal.aborted
          ) {
            throw new Error("Request aborted");
          }

          let targetFilePath: string | undefined;
          if (call.name === "write_file" || call.name === "edit_file") {
            const args = (call.arguments || {}) as { path?: string };
            targetFilePath = args.path;
          }

          this.diagnosticsManager.recordToolStart(
            runId,
            call.name,
            call.id,
            targetFilePath
          );

          const toolStartEv: AgentEvent = {
            type: "tool_started",
            runId,
            toolName: call.name,
            callId: call.id
          };
          this.diagnosticsManager.recordEvent(runId, toolStartEv);
          if (this.emitRunEvents) {
            yield toolStartEv;
          }

          const toolContext = {
            cwd: input.cwd,
            signal: this.activeController.signal
          };

          const tool = this.registry.get(call.name);
          let result: ToolResult = {
            success: false,
            error: {
              message: "Tool execution failed",
              code: "UNEXPECTED_ERROR"
            }
          };

          const callKey = `${call.name}::${JSON.stringify(call.arguments || {})}`;
          if (this.lastToolCallKey === callKey) {
            this.consecutiveToolCallCount++;
          } else {
            this.lastToolCallKey = callKey;
            this.consecutiveToolCallCount = 1;
          }

          if (this.consecutiveToolCallCount > this.maxIdenticalToolCalls) {
            result = {
              success: false,
              error: {
                message: `Repeated identical tool call loop detected (${call.name} called ${this.consecutiveToolCallCount} times with identical arguments). Modify parameters, broaden search, or proceed with an alternative approach.`,
                code: "REPEATED_CALL_LOOP"
              }
            };
          } else if (!tool) {
            result = {
              success: false,
              error: {
                message: `Tool not found: ${call.name}`,
                code: "NOT_FOUND"
              }
            };
          } else {
            let affectedFilePath: string | undefined;
            if (call.name === "write_file" || call.name === "edit_file") {
              const args = (call.arguments || {}) as { path?: string };
              affectedFilePath = args.path;
            }

            const toolRisk = this.executionPolicy.assess({
              userMessage: input.message,
              cwd: input.cwd,
              affectedFiles: affectedFilePath ? [affectedFilePath] : [],
              operations: [call.name]
            });

            let checkpointError: ToolResult | null = null;
            if (
              toolRisk.requiresCheckpoint &&
              this.checkpointManager &&
              !this.completionTracker.getSummary().checkpointId
            ) {
              try {
                const cpRes = await this.checkpointManager.create({
                  cwd: input.cwd,
                  taskId: this.state.sessionId,
                  reason:
                    toolRisk.reasons.join("; ") ||
                    "Elevated/Critical risk mutation",
                  affectedFiles: affectedFilePath ? [affectedFilePath] : [],
                  signal: this.activeController.signal
                });
                if (cpRes.success && cpRes.checkpoint) {
                  this.completionTracker.setCheckpointId(cpRes.checkpoint.id);
                } else {
                  checkpointError = {
                    success: false,
                    error: {
                      message: `Checkpoint creation failed: ${cpRes.error || "Unknown error"}. Mutation blocked for safety.`,
                      code: "CHECKPOINT_FAILED"
                    }
                  };
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                checkpointError = {
                  success: false,
                  error: {
                    message: `Checkpoint creation failed: ${msg}. Mutation blocked for safety.`,
                    code: "CHECKPOINT_FAILED"
                  }
                };
              }
            }

            if (checkpointError) {
              result = checkpointError;
            } else {
              const decision = await this.permissionManager.check(
                tool,
                toolContext
              );

            if (decision.type === "denied") {
              result = {
                success: false,
                error: {
                  message: decision.reason,
                  code: "PERMISSION_DENIED"
                }
              };
            } else if (decision.type === "requires_approval") {
              let skipApproval = false;
              let changeReview: unknown;

              if (call.name === "edit_file") {
                const args = (call.arguments || {}) as {
                  path?: string;
                  oldText?: string;
                  newText?: string;
                  expectedHash?: string;
                };

                if (
                  args.oldText !== undefined &&
                  args.newText !== undefined &&
                  args.oldText === args.newText
                ) {
                  // No-op edit: identical oldText and newText
                  skipApproval = true;
                  result = {
                    success: true,
                    output: {
                      path: args.path || "",
                      replacements: 0,
                      bytesWritten: 0,
                      changed: false,
                      reason: "NO_CHANGE"
                    }
                  };
                } else {
                  const validated = await this.safeEditValidator.validateEdit(
                    args.path || "",
                    args.oldText || "",
                    args.newText || "",
                    toolContext.cwd,
                    {
                      expectedHash: args.expectedHash,
                      signal: toolContext.signal
                    }
                  );

                  if (!validated.valid) {
                    skipApproval = true;
                    result = {
                      success: false,
                      error: validated.error
                    };
                  } else {
                    const stats = calculateDiffStats(validated.diff);
                    if (stats.additions === 0 && stats.deletions === 0) {
                      // No-op (+0 -0)
                      skipApproval = true;
                      result = {
                        success: true,
                        output: {
                          path: validated.displayPath,
                          replacements: 0,
                          bytesWritten: 0,
                          changed: false,
                          reason: "NO_CHANGE"
                        }
                      };
                    } else {
                      const fileReview: ChangeReviewFile = {
                        path: validated.displayPath,
                        operation: "modified",
                        additions: stats.additions,
                        deletions: stats.deletions,
                        diff: validated.diff
                      };
                      changeReview = createChangeReview([fileReview]);
                    }
                  }
                }
              } else if (call.name === "write_file") {
                const args = (call.arguments || {}) as {
                  path?: string;
                  content?: string;
                };

                const validated = await this.safeEditValidator.validateWrite(
                  args.path || "",
                  args.content || "",
                  toolContext.cwd,
                  { signal: toolContext.signal }
                );

                if (!validated.valid) {
                  skipApproval = true;
                  result = {
                    success: false,
                    error: validated.error
                  };
                } else if (
                  validated.originalContent === validated.proposedContent &&
                  validated.originalContent !== ""
                ) {
                  // No-op write: identical content
                  skipApproval = true;
                  result = {
                    success: true,
                    output: {
                      path: validated.displayPath,
                      created: false,
                      overwritten: true,
                      bytesWritten: Buffer.byteLength(
                        validated.proposedContent,
                        "utf-8"
                      ),
                      changed: false,
                      reason: "NO_CHANGE"
                    }
                  };
                } else {
                  const stats = calculateDiffStats(validated.diff);
                  const isNew = validated.originalContent === "";
                  const fileReview: ChangeReviewFile = {
                    path: validated.displayPath,
                    operation: isNew ? "added" : "modified",
                    additions: stats.additions,
                    deletions: stats.deletions,
                    diff: validated.diff
                  };
                  changeReview = createChangeReview([fileReview]);
                }
              }

              if (!skipApproval) {
                const approvalRequest: ApprovalRequest = {
                  id: `approval-${call.id}`,
                  toolName: tool.name,
                  category: tool.permissionCategory || "write",
                  arguments: call.arguments,
                  reason: decision.reason,
                  changeReview
                };

                yield { type: "approval_required", request: approvalRequest };

                let approvalDecision: ApprovalDecision = {
                  approved: false,
                  reason: "Approval required but no resolver configured."
                };

                if (this.approvalResolver) {
                  approvalDecision = await this.approvalResolver.resolve(
                    approvalRequest
                  );
                }

                if (approvalDecision.approved) {
                  result = await this.executor.execute(call, toolContext);
                } else {
                  result = {
                    success: false,
                    error: {
                      message:
                        approvalDecision.reason ||
                        "Tool execution was denied by the user.",
                      code: "PERMISSION_DENIED"
                    }
                  };
                }
              }
            } else {
              result = await this.executor.execute(call, toolContext);
            }
          }
        }

          yield { type: "tool_result", result, callId: call.id };

          this.diagnosticsManager.recordToolComplete(
            runId,
            call.id,
            result.success,
            result.error?.code
          );

          const toolCompEv: AgentEvent = {
            type: "tool_completed",
            runId,
            toolName: call.name,
            callId: call.id,
            success: result.success
          };
          this.diagnosticsManager.recordEvent(runId, toolCompEv);
          if (this.emitRunEvents) {
            yield toolCompEv;
          }

          if (this.currentPlan) {
            const pendingOrActiveStep = this.currentPlan.steps.find(
              (s) => s.status === "in_progress" || s.status === "pending"
            );
            if (pendingOrActiveStep) {
              try {
                if (result.success) {
                  this.currentPlan = completePlanStep(
                    this.currentPlan,
                    pendingOrActiveStep.stepId
                  );
                  this.diagnosticsManager.updatePlanStep(
                    runId,
                    pendingOrActiveStep.stepId,
                    "completed"
                  );
                  if (this.emitRunEvents) {
                    yield {
                      type: "plan_step_completed",
                      planId: this.currentPlan.planId,
                      stepId: pendingOrActiveStep.stepId,
                      stepIndex: pendingOrActiveStep.order - 1
                    };
                  }
                } else if (result.error?.code !== "NO_CHANGE") {
                  this.currentPlan = failPlanStep(
                    this.currentPlan,
                    pendingOrActiveStep.stepId,
                    result.error?.message
                  );
                  this.diagnosticsManager.updatePlanStep(
                    runId,
                    pendingOrActiveStep.stepId,
                    "failed",
                    result.error?.message
                  );
                  if (this.emitRunEvents) {
                    yield {
                      type: "plan_step_failed",
                      planId: this.currentPlan.planId,
                      stepId: pendingOrActiveStep.stepId,
                      stepIndex: pendingOrActiveStep.order - 1,
                      error: result.error?.message
                    };
                  }
                }
                this.diagnosticsManager.recordPlan(runId, this.currentPlan);
              } catch {
                // Ignore
              }
            }
          }

          this.state.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result)
          });

          // Invalidate repository exploration & code context caches if file was modified
          if (
            result.success &&
            (call.name === "write_file" || call.name === "edit_file")
          ) {
            this.lastToolCallKey = null;
            this.consecutiveToolCallCount = 0;
            const targetPath = (call.arguments as { path?: string })?.path;

            const output = result.output as {
              path?: string;
              diff?: string;
              changed?: boolean;
              created?: boolean;
            };

            if (targetPath && output?.changed !== false) {
              const diffStr = output?.diff || "";
              const stats = calculateDiffStats(diffStr);
              const op =
                call.name === "write_file" && output?.created
                  ? "added"
                  : "modified";
              this.completionTracker.recordFileChange({
                path: targetPath,
                operation: op,
                additions: stats.additions,
                deletions: stats.deletions
              });
              this.diagnosticsManager.recordFileChange(runId, targetPath, op);
            } else if (targetPath) {
              this.completionTracker.recordFileModified(targetPath);
              this.diagnosticsManager.recordFileChange(
                runId,
                targetPath,
                "modified"
              );
            }
            if (this.repositoryExplorer) {
              this.repositoryExplorer.invalidate(targetPath);
            }
            if (this.codeContextSelector) {
              this.codeContextSelector.invalidate(targetPath);
            }
          }

          if (!result.success && result.error?.code === "PERMISSION_DENIED") {
            this.completionTracker.recordBlocked(
              result.error.message || `Permission denied for ${call.name}`
            );
          }

          // Check if this was a command execution
          if (call.name === "execute_command") {
            const cmdOutput = result.output as CommandResult | undefined;
            const isFailure =
              !result.success ||
              (cmdOutput && cmdOutput.exitCode !== 0) ||
              Boolean(cmdOutput && cmdOutput.timedOut);

            const cmd = (call.arguments as { command?: string })?.command || "";
            const exitCode = cmdOutput ? cmdOutput.exitCode : (result.success ? 0 : 1);
            const timedOut = Boolean(cmdOutput?.timedOut);
            const succeeded = result.success && exitCode === 0 && !timedOut;

            if (this.currentRunStateMachine?.getState() === "executing") {
              yield* this.transitionRunState(
                "verifying",
                `Running verification: ${cmd}`
              );
            }

            const attemptNum = (this.state.verificationAttempts || 0) + 1;
            this.diagnosticsManager.recordVerificationStart(
              runId,
              cmd,
              attemptNum
            );
            const vStartEv: AgentEvent = {
              type: "verification_started",
              runId,
              command: cmd,
              attempt: attemptNum
            };
            this.diagnosticsManager.recordEvent(runId, vStartEv);
            if (this.emitRunEvents) {
              yield vStartEv;
            }

            const attemptDoneNum = attemptNum;
            this.diagnosticsManager.recordVerificationComplete(
              runId,
              cmd,
              attemptDoneNum,
              succeeded,
              exitCode,
              timedOut
            );
            const vCompEv: AgentEvent = {
              type: "verification_completed",
              runId,
              command: cmd,
              success: succeeded,
              attempt: attemptDoneNum
            };
            this.diagnosticsManager.recordEvent(runId, vCompEv);
            if (this.emitRunEvents) {
              yield vCompEv;
            }

            this.completionTracker.recordCommandExecution({
              command: cmd,
              exitCode,
              timedOut,
              succeeded
            });

            if (isFailure) {
              const attempts: number = (this.state.verificationAttempts || 0) + 1;
              this.state.verificationAttempts = attempts;
              this.currentRunStateMachine?.incrementVerificationAttempts();

              if (attempts >= this.maxVerificationAttempts) {
                this.completionTracker.recordBlocked(
                  `Verification failed after ${this.maxVerificationAttempts} attempts`
                );
                this.state.messages.push({
                  role: "user",
                  content: `[SYSTEM NOTICE] Maximum verification attempts (${this.maxVerificationAttempts}) reached. Do not attempt further verification commands. Report the current status, failure details, and remaining unresolved issues to the user.`
                });
                yield* this.transitionRunState(
                  "failed",
                  `Verification failed after ${this.maxVerificationAttempts} attempts`
                );
              } else {
                yield* this.transitionRunState(
                  "executing",
                  "Verification failed; fix attempt permitted"
                );
              }
            } else if (this.currentRunStateMachine?.getState() === "verifying") {
              yield* this.transitionRunState(
                "executing",
                "Verification succeeded"
              );
            }
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isCancelled =
        this.activeController?.signal.aborted ||
        error.message.toLowerCase().includes("abort") ||
        error.message.toLowerCase().includes("cancel");

      if (isCancelled) {
        this.completionTracker.recordCancelled();
        yield* this.transitionRunState("cancelled", "Run cancelled");
      } else {
        this.completionTracker.recordBlocked(error.message);
        yield* this.transitionRunState("failed", error.message);
      }
      yield { type: "error", error };
    } finally {
      this.activeController = null;
      if (this.currentPlan) {
        const smState = this.currentRunStateMachine?.getState();
        if (
          smState === "completed" &&
          this.currentPlan.status !== "completed"
        ) {
          try {
            this.currentPlan = transitionPlanStatus(
              this.currentPlan,
              "completed"
            );
          } catch {
            // ignore
          }
        } else if (
          (smState === "cancelled" || this.state.status === "cancelled") &&
          this.currentPlan.status !== "cancelled"
        ) {
          try {
            this.currentPlan = transitionPlanStatus(
              this.currentPlan,
              "cancelled"
            );
          } catch {
            // ignore
          }
        } else if (
          smState === "failed" &&
          this.currentPlan.status !== "failed"
        ) {
          try {
            this.currentPlan = transitionPlanStatus(
              this.currentPlan,
              "failed"
            );
          } catch {
            // ignore
          }
        }
        this.diagnosticsManager.recordPlan(runId, this.currentPlan);
      }

      const finalSummary = this.diagnosticsManager.getRunSummary(runId);
      if (finalSummary) {
        try {
          await this.historyStore.saveRun(
            finalSummary,
            this.currentProjectId,
            this.currentWorkspaceFingerprint,
            this.currentParentRunId,
            this.currentResumeDepth
          );
        } catch {
          // Non-fatal persistence error
        }
      }
    }
  }

  async cancel(): Promise<void> {
    this.completionTracker.recordCancelled();
    if (this.state.activePlan && this.state.activePlan.status === "in_progress") {
      const currentIdx = this.state.activePlan.currentStep ?? 0;
      this.state.activePlan = failTaskStep(
        this.state.activePlan,
        currentIdx,
        "Cancelled"
      );
    }
    if (
      this.currentPlan &&
      this.currentPlan.status !== "cancelled" &&
      this.currentPlan.status !== "completed"
    ) {
      try {
        this.currentPlan = transitionPlanStatus(this.currentPlan, "cancelled");
      } catch {
        // ignore
      }
    }
    if (this.currentRunStateMachine && !this.currentRunStateMachine.isTerminal()) {
      const runId = this.currentRunStateMachine.getContext().runId;
      if (this.currentPlan) {
        this.diagnosticsManager.recordPlan(runId, this.currentPlan);
      }
      this.currentRunStateMachine.transition("cancelled", "Run cancelled");
      this.state.status = "cancelled";
      this.diagnosticsManager.recordStateChange(runId, {
        timestamp: Date.now(),
        from: "executing",
        to: "cancelled",
        reason: "Run cancelled"
      });
      this.diagnosticsManager.completeRun(runId, "cancelled", "Run cancelled");
      this.diagnosticsManager.recordEvent(runId, {
        type: "run_cancelled",
        runId
      });
      const terminalSummary = this.diagnosticsManager.getRunSummary(runId);
      if (terminalSummary) {
        this.historyStore
          .saveRun(
            terminalSummary,
            this.currentProjectId,
            this.currentWorkspaceFingerprint,
            this.currentParentRunId,
            this.currentResumeDepth
          )
          .catch(() => {});
      }
    }
    if (this.activeController) {
      this.state.status = "cancelled";
      this.activeController.abort();
    }
  }
}
