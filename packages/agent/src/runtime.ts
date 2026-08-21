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
import type { TaskPlan } from "./tasks/types.js";
import { failTaskStep } from "./tasks/taskPlan.js";
import { SafeEditValidator } from "./editing/validator.js";
import {
  calculateDiffStats,
  createChangeReview,
  type ChangeReviewFile
} from "./editing/changeReview.js";

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
  activePlan?: TaskPlan;
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
  private readonly completionTracker: TaskCompletionTracker = new TaskCompletionTracker();
  private readonly safeEditValidator: SafeEditValidator = new SafeEditValidator();
  private currentRunStateMachine?: AgentRunStateMachine;
  private currentParentRunId?: string;
  private currentResumeDepth?: number;
  private currentProjectId?: string;
  private currentWorkspaceFingerprint?: WorkspaceFingerprint;
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

  public getPlan(): TaskPlan | undefined {
    return this.state.activePlan;
  }

  public setPlan(plan: TaskPlan): void {
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
    if (this.currentRunStateMachine && !this.currentRunStateMachine.isTerminal()) {
      const runId = this.currentRunStateMachine.getContext().runId;
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
