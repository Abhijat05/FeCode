import type { ApprovalDecision, ApprovalResolver } from "@fecode/models";
import type { TaskRiskAssessment, TaskRiskContext } from "../policy/types.js";
import type { RunSummary } from "../diagnostics/types.js";
import type { DurableRunRecord, ResumePreparation } from "../history/types.js";
import type {
  TaskPlan,
  ReplanAssessment,
  ReplanRequest,
  ReplanResult,
  PlanAdaptationAssessment,
  ExecutionDecision,
  ExecutionDecisionResult,
  FinalReconciliationResult,
  ExecutionRecoveryAssessment,
  ExecutionRecoveryResult,
  RecoveryOutcomeStatus,
  RecoveryContinuationPreparation,
  RecoveryContinuationRequest
} from "../planning/types.js";
import type { GitRepository } from "../git/types.js";
import { DefaultGitRepository } from "../git/gitRepository.js";
import type { AgentRuntime } from "../runtime.js";
import { createInitialUIState, reduceUIState } from "./uiReducer.js";
import type {
  ProductRuntime,
  TaskSubmissionRequest,
  ProductEvent,
  UIState,
  RunSnapshot,
  PlanSnapshot,
  WorkspaceSnapshot,
  UIStatus
} from "./types.js";

export interface ProductRuntimeOptions {
  agentRuntime: AgentRuntime;
  gitRepository?: GitRepository;
  approvalResolver?: ApprovalResolver;
  initialCwd?: string;
  initialSessionId?: string;
}

export class DefaultProductRuntime implements ProductRuntime {
  private readonly agentRuntime: AgentRuntime;
  private readonly gitRepository: GitRepository;
  private readonly approvalResolver?: ApprovalResolver;
  private uiState: UIState;
  private readonly subscribers: Set<(state: UIState, event?: ProductEvent) => void> = new Set();

  constructor(options: ProductRuntimeOptions) {
    this.agentRuntime = options.agentRuntime;
    this.gitRepository =
      options.gitRepository ||
      ("getGitRepository" in this.agentRuntime &&
      typeof (this.agentRuntime as unknown as { getGitRepository: () => GitRepository }).getGitRepository === "function"
        ? (this.agentRuntime as unknown as { getGitRepository: () => GitRepository }).getGitRepository()
        : new DefaultGitRepository());
    this.approvalResolver =
      options.approvalResolver ||
      ("getApprovalResolver" in this.agentRuntime &&
      typeof (this.agentRuntime as unknown as { getApprovalResolver: () => ApprovalResolver }).getApprovalResolver === "function"
        ? (this.agentRuntime as unknown as { getApprovalResolver: () => ApprovalResolver }).getApprovalResolver()
        : undefined);

    this.uiState = createInitialUIState({
      cwd: options.initialCwd || process.cwd(),
      sessionId: options.initialSessionId
    });
  }

  public async *submitTask(
    request: TaskSubmissionRequest
  ): AsyncIterable<ProductEvent> {
    const previousStatus = this.uiState.status;
    this.uiState.userRequest = request.message;
    this.uiState.cwd = request.cwd;
    this.uiState.status = "executing";
    this.uiState.lifecycleState = "executing";
    this.uiState.error = undefined;
    this.uiState.pendingApproval = undefined;
    this.uiState.timeline.push({
      id: `tl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "run_event",
      timestamp: Date.now(),
      title: "Task submitted",
      description: request.message,
      status: "running"
    });

    const startEvent: ProductEvent = {
      type: "run_status_changed",
      runId: this.uiState.runId || "pending",
      status: "executing",
      previousStatus
    };
    this.notifySubscribers(startEvent);
    yield startEvent;

    try {
      const agentStream = this.agentRuntime.run({
        message: request.message,
        cwd: request.cwd,
        sessionId: request.sessionId || this.uiState.sessionId,
        provider: request.provider,
        parentRunId: request.parentRunId
      });

      for await (const rawEvent of agentStream) {
        const prevUiStatus: UIStatus = this.uiState.status;
        this.uiState = reduceUIState(this.uiState, rawEvent);

        // Yield raw event
        const rawProductEvent: ProductEvent = {
          type: "raw_agent_event",
          event: rawEvent
        };
        this.notifySubscribers(rawProductEvent);
        yield rawProductEvent;

        // Text chunk product event
        if (rawEvent.type === "text") {
          const textEvent: ProductEvent = {
            type: "text_chunk",
            text: rawEvent.content
          };
          this.notifySubscribers(textEvent);
          yield textEvent;
        }

        // Status changed product event
        if (this.uiState.status !== prevUiStatus) {
          const statusEvent: ProductEvent = {
            type: "run_status_changed",
            runId: this.uiState.runId || "unknown",
            status: this.uiState.status,
            previousStatus: prevUiStatus
          };
          this.notifySubscribers(statusEvent);
          yield statusEvent;
        }

        // Plan updated product event
        if (rawEvent.type === "plan_created" && this.uiState.activePlan) {
          const planEvent: ProductEvent = {
            type: "plan_updated",
            plan: this.uiState.activePlan
          };
          this.notifySubscribers(planEvent);
          yield planEvent;
        }

        // Approval requested product event
        if (
          (rawEvent.type === "approval_required" ||
            rawEvent.type === "plan_step_waiting_approval" ||
            rawEvent.type === "checkpoint_approval_requested") &&
          this.uiState.pendingApproval
        ) {
          const appEvent: ProductEvent = {
            type: "approval_requested",
            approval: this.uiState.pendingApproval
          };
          this.notifySubscribers(appEvent);
          yield appEvent;
        }

        // Tool activity changed product event
        if (rawEvent.type === "tool_started" || rawEvent.type === "tool_completed") {
          const toolEvent: ProductEvent = {
            type: "tool_activity_changed",
            activity: this.uiState.activeTool
          };
          this.notifySubscribers(toolEvent);
          yield toolEvent;
        }

        // Emit updated full UI state
        const stateEvent: ProductEvent = {
          type: "ui_state_changed",
          state: this.getUIState()
        };
        this.notifySubscribers(stateEvent);
        yield stateEvent;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.uiState.status = "failed";
      this.uiState.lifecycleState = "failed";
      this.uiState.error = msg;

      const failEvent: ProductEvent = {
        type: "run_status_changed",
        runId: this.uiState.runId || "unknown",
        status: "failed",
        previousStatus: "executing"
      };
      this.notifySubscribers(failEvent);
      yield failEvent;
    }
  }

  public async cancelCurrentRun(): Promise<void> {
    const previousStatus = this.uiState.status;
    await this.agentRuntime.cancel();
    this.uiState.status = "cancelled";
    this.uiState.lifecycleState = "cancelled";
    const cancelEvent: ProductEvent = {
      type: "run_status_changed",
      runId: this.uiState.runId || "unknown",
      status: "cancelled",
      previousStatus
    };
    this.notifySubscribers(cancelEvent);
  }

  public async resolveApproval(decision: ApprovalDecision): Promise<void> {
    if (!this.approvalResolver) {
      throw new Error("No ApprovalResolver configured in ProductRuntime.");
    }
    if (!this.uiState.pendingApproval) {
      return;
    }
    // Interactive approval resolvers consume resolve calls
    if ("resolve" in this.approvalResolver && typeof this.approvalResolver.resolve === "function") {
      // If interactive resolver handles external decisions
      if ("submitDecision" in this.approvalResolver && typeof (this.approvalResolver as unknown as { submitDecision: (d: ApprovalDecision) => void }).submitDecision === "function") {
        (this.approvalResolver as unknown as { submitDecision: (d: ApprovalDecision) => void }).submitDecision(decision);
      }
    }
  }

  public getUIState(): UIState {
    return {
      ...this.uiState,
      timeline: [...this.uiState.timeline],
      messages: [...this.uiState.messages],
      skills: [...this.uiState.skills],
      activePlan: this.uiState.activePlan
        ? {
            ...this.uiState.activePlan,
            steps: this.uiState.activePlan.steps.map((s) => ({ ...s }))
          }
        : undefined,
      pendingApproval: this.uiState.pendingApproval
        ? { ...this.uiState.pendingApproval, affectedTargets: [...this.uiState.pendingApproval.affectedTargets] }
        : undefined,
      activeTool: this.uiState.activeTool ? { ...this.uiState.activeTool } : undefined,
      activeVerification: this.uiState.activeVerification ? { ...this.uiState.activeVerification } : undefined,
      activeRecovery: this.uiState.activeRecovery ? { ...this.uiState.activeRecovery } : undefined
    };
  }

  public getCurrentRunSnapshot(): RunSnapshot | undefined {
    if (!this.uiState.runId) {
      return undefined;
    }
    return {
      runId: this.uiState.runId,
      sessionId: this.uiState.sessionId,
      userRequest: this.uiState.userRequest || "",
      status: this.uiState.status,
      lifecycleState: this.uiState.lifecycleState,
      startedAt: this.uiState.timeline[0]?.timestamp || Date.now(),
      error: this.uiState.error,
      activePlan: this.getActivePlanSnapshot()
    };
  }

  public getActivePlanSnapshot(): PlanSnapshot | undefined {
    if (!this.uiState.activePlan) return undefined;
    return {
      ...this.uiState.activePlan,
      steps: this.uiState.activePlan.steps.map((s) => ({ ...s }))
    };
  }

  public getRiskAssessment(context?: TaskRiskContext): TaskRiskAssessment {
    const ctx: TaskRiskContext = context || {
      userMessage: this.uiState.userRequest || "",
      cwd: this.uiState.cwd,
      affectedFiles: [],
      operations: []
    };
    return this.agentRuntime.assessTaskRisk(ctx);
  }

  public getActiveSkills(): string[] {
    return [...this.uiState.skills];
  }

  public async getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
    const cwd = this.uiState.cwd;
    let gitBranch: string | null = null;
    let isGitDirty = false;
    const modifiedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    const stagedFiles: string[] = [];

    try {
      gitBranch = await this.gitRepository.getBranch(cwd);
      const statusRes = await this.gitRepository.getStatus(cwd);
      if (statusRes && statusRes.files) {
        isGitDirty = statusRes.files.length > 0;
        modifiedFiles.push(
          ...statusRes.files
            .filter((f) => f.indexStatus === "M" || f.worktreeStatus === "M")
            .map((f) => f.path)
        );
        untrackedFiles.push(
          ...statusRes.files
            .filter((f) => f.indexStatus === "?" || f.worktreeStatus === "?")
            .map((f) => f.path)
        );
        stagedFiles.push(
          ...statusRes.files
            .filter((f) => f.indexStatus && f.indexStatus !== "?" && f.indexStatus !== " ")
            .map((f) => f.path)
        );
      }
    } catch {
      // Non-git workspace
    }

    return {
      cwd,
      gitBranch,
      isGitDirty,
      untrackedFiles,
      modifiedFiles,
      stagedFiles,
      recentChanges: modifiedFiles.map((p) => ({ path: p, status: "modified" })),
      hasDrift: false
    };
  }

  public getDiagnosticsSummary(runId?: string): RunSummary | undefined {
    return this.agentRuntime.getRunSummary(runId);
  }

  public async getHistoricalRuns(options?: {
    limit?: number;
  }): Promise<DurableRunRecord[]> {
    return this.agentRuntime.listHistoricalRuns(options);
  }

  public async getHistoricalRun(runId: string): Promise<DurableRunRecord | null> {
    return this.agentRuntime.getHistoricalRun(runId);
  }

  public async getRunLineage(runId: string): Promise<DurableRunRecord[]> {
    return this.agentRuntime.getRunLineage(runId);
  }

  public async prepareReplan(
    planId?: string,
    opts?: { cwd: string }
  ): Promise<ReplanAssessment> {
    return this.agentRuntime.prepareReplan(planId, opts);
  }

  public async executeReplan(request: ReplanRequest): Promise<ReplanResult> {
    return this.agentRuntime.executeReplan(request);
  }

  public async prepareResume(
    runId: string,
    cwd: string
  ): Promise<ResumePreparation> {
    return this.agentRuntime.prepareResume(runId, cwd);
  }

  public async *resumeRun(runId: string): AsyncIterable<ProductEvent> {
    try {
      const stream = this.agentRuntime.resumeRun(runId);
      for await (const rawEvent of stream) {
        const prevUiStatus: UIStatus = this.uiState.status;
        this.uiState = reduceUIState(this.uiState, rawEvent);

        const rawProductEvent: ProductEvent = {
          type: "raw_agent_event",
          event: rawEvent
        };
        this.notifySubscribers(rawProductEvent);
        yield rawProductEvent;

        if (rawEvent.type === "text") {
          const textEvent: ProductEvent = {
            type: "text_chunk",
            text: rawEvent.content
          };
          this.notifySubscribers(textEvent);
          yield textEvent;
        }

        if (this.uiState.status !== prevUiStatus) {
          const statusEvent: ProductEvent = {
            type: "run_status_changed",
            runId: this.uiState.runId || runId,
            status: this.uiState.status,
            previousStatus: prevUiStatus
          };
          this.notifySubscribers(statusEvent);
          yield statusEvent;
        }

        const stateEvent: ProductEvent = {
          type: "ui_state_changed",
          state: this.getUIState()
        };
        this.notifySubscribers(stateEvent);
        yield stateEvent;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.uiState.status = "failed";
      this.uiState.error = msg;
      const failEvent: ProductEvent = {
        type: "run_status_changed",
        runId,
        status: "failed",
        previousStatus: "executing"
      };
      this.notifySubscribers(failEvent);
      yield failEvent;
    }
  }

  public async assessExecutionRecovery(
    planId?: string,
    opts?: { cwd: string; reconciliationResult?: FinalReconciliationResult }
  ): Promise<ExecutionRecoveryAssessment> {
    return this.agentRuntime.assessExecutionRecovery(planId, opts);
  }

  public async *executeExecutionRecovery(
    assessment: ExecutionRecoveryAssessment,
    opts: { cwd: string; approved: boolean }
  ): AsyncIterable<ProductEvent> {
    try {
      const stream = this.agentRuntime.executeExecutionRecovery(assessment, opts);
      for await (const rawEvent of stream) {
        this.uiState = reduceUIState(this.uiState, rawEvent);
        const rawProductEvent: ProductEvent = {
          type: "raw_agent_event",
          event: rawEvent
        };
        this.notifySubscribers(rawProductEvent);
        yield rawProductEvent;

        const stateEvent: ProductEvent = {
          type: "ui_state_changed",
          state: this.getUIState()
        };
        this.notifySubscribers(stateEvent);
        yield stateEvent;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.uiState.status = "failed";
      this.uiState.error = msg;
    }
  }

  public async prepareRecoveryContinuation(opts: {
    cwd: string;
    recoveryResult: ExecutionRecoveryResult;
    recoveryOutcome: RecoveryOutcomeStatus;
  }): Promise<RecoveryContinuationPreparation> {
    return this.agentRuntime.prepareRecoveryContinuation(opts);
  }

  public async *continueRecoveredPlan(
    preparation: RecoveryContinuationPreparation,
    request: RecoveryContinuationRequest
  ): AsyncIterable<ProductEvent> {
    try {
      const stream = this.agentRuntime.continueRecoveredPlan(preparation, request);
      for await (const rawEvent of stream) {
        this.uiState = reduceUIState(this.uiState, rawEvent);
        const rawProductEvent: ProductEvent = {
          type: "raw_agent_event",
          event: rawEvent
        };
        this.notifySubscribers(rawProductEvent);
        yield rawProductEvent;

        const stateEvent: ProductEvent = {
          type: "ui_state_changed",
          state: this.getUIState()
        };
        this.notifySubscribers(stateEvent);
        yield stateEvent;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.uiState.status = "failed";
      this.uiState.error = msg;
    }
  }

  public async resolveExecutionDecision(
    planId: string,
    decision: ExecutionDecision,
    opts?: { cwd: string }
  ): Promise<ExecutionDecisionResult> {
    return this.agentRuntime.resolveExecutionDecision(planId, decision, opts);
  }

  public getTaskPlan(): TaskPlan | undefined {
    return this.agentRuntime.getTaskPlan();
  }

  public getPlanAdaptationAssessment(): PlanAdaptationAssessment | undefined {
    return this.agentRuntime.getPlanAdaptationAssessment();
  }

  public subscribe(
    listener: (state: UIState, event?: ProductEvent) => void
  ): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notifySubscribers(event: ProductEvent): void {
    const snapshot = this.getUIState();
    for (const listener of this.subscribers) {
      try {
        listener(snapshot, event);
      } catch {
        // Prevent subscriber errors from disrupting runtime
      }
    }
  }
}

