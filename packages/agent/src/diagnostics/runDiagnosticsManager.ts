import type { AgentEvent } from "../index.js";
import type { AgentRunTransition } from "../run/types.js";
import type { TaskRiskLevel } from "../policy/types.js";
import type {
  RunDiagnosticsManager,
  RunDiagnosticsManagerOptions,
  RunSummary
} from "./types.js";

function sanitizeString(str: string): string {
  // Scrub typical secret patterns if present
  return str
    .replace(/(?:sk-[a-zA-Z0-9_-]{20,})/g, "[REDACTED_API_KEY]")
    .replace(/(?:AIza[0-9A-Za-z-_]{35})/g, "[REDACTED_API_KEY]")
    .replace(/(?:ghp_[a-zA-Z0-9]{36})/g, "[REDACTED_TOKEN]");
}

export class DefaultRunDiagnosticsManager implements RunDiagnosticsManager {
  private readonly maxRetainedRuns: number;
  private readonly maxEventsPerRun: number;

  private readonly runOrder: string[] = [];
  private readonly runSummaries = new Map<string, RunSummary>();
  private readonly runEvents = new Map<string, AgentEvent[]>();

  constructor(options: RunDiagnosticsManagerOptions = {}) {
    this.maxRetainedRuns = options.maxRetainedRuns ?? 50;
    this.maxEventsPerRun = options.maxEventsPerRun ?? 1000;
  }

  public startRun(params: {
    runId: string;
    parentRunId?: string;
    resumeDepth?: number;
    cwd: string;
    userRequest: string;
    activeSkills?: string[];
    riskLevel?: TaskRiskLevel;
    riskReasons?: string[];
    requiresCheckpoint?: boolean;
    requiresExplicitApproval?: boolean;
    maxVerificationAttempts?: number;
    maxRecoveryAttempts?: number;
    checkpointId?: string;
  }): void {
    // Evict oldest if limit reached
    while (this.runOrder.length >= this.maxRetainedRuns) {
      const oldest = this.runOrder.shift();
      if (oldest) {
        this.runSummaries.delete(oldest);
        this.runEvents.delete(oldest);
      }
    }

    if (!this.runSummaries.has(params.runId)) {
      this.runOrder.push(params.runId);
    }

    const summary: RunSummary = {
      runId: params.runId,
      parentRunId: params.parentRunId,
      resumeDepth: params.resumeDepth,
      startedAt: Date.now(),
      finalStatus: "idle",
      cwd: params.cwd,
      userRequestSummary: sanitizeString(params.userRequest.slice(0, 300)),
      activeSkills: params.activeSkills ? [...params.activeSkills] : [],
      initialRiskLevel: params.riskLevel || "low",
      riskReasons: params.riskReasons ? [...params.riskReasons] : [],
      requiresCheckpoint: Boolean(params.requiresCheckpoint),
      requiresExplicitApproval: Boolean(params.requiresExplicitApproval),
      checkpointId: params.checkpointId,
      verificationAttempts: 0,
      maxVerificationAttempts: params.maxVerificationAttempts ?? 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: params.maxRecoveryAttempts ?? 1,
      tools: [],
      commands: [],
      recovery: [],
      files: {
        modified: [],
        created: [],
        deleted: []
      },
      lifecycleTransitions: []
    };

    this.runSummaries.set(params.runId, summary);
    this.runEvents.set(params.runId, []);
  }

  public recordStateChange(
    runId: string,
    transition: AgentRunTransition
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.lifecycleTransitions.push({ ...transition });
    summary.finalStatus = transition.to;
  }

  public recordPlan(
    runId: string,
    plan: import("../planning/types.js").TaskPlan
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: "",
        userRequest: plan.userRequestSummary || plan.objective
      });
      summary = this.runSummaries.get(runId);
    }
    if (!summary) return;

    summary.planId = plan.planId;
    summary.planStatus = plan.status;
    summary.totalPlanSteps = plan.steps.length;
    summary.completedPlanSteps = plan.steps.filter(
      (s) => s.status === "completed"
    ).length;
    summary.skippedPlanSteps = plan.steps.filter(
      (s) => s.status === "skipped"
    ).length;
    summary.failedPlanStep = plan.steps.find(
      (s) => s.status === "failed"
    )?.stepId;
    summary.currentPlanStep = (plan.currentStepIndex ?? 0) + 1;
    summary.replanCount = plan.replanCount;
    summary.parentPlanId = plan.parentPlanId;
    summary.replanDepth = plan.replanDepth;
    summary.replanReason = plan.replanReason;
    if (plan.parentPlanId && !summary.replanTimestamp) {
      summary.replanTimestamp = Date.now();
    }
    summary.planInvalidationReason = plan.invalidationReason;
    summary.planSummary = plan.objective;
  }

  public updatePlanStep(
    runId: string,
    stepId: string,
    status: import("../planning/types.js").PlanStepStatus,
    error?: string
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    if (status === "completed") {
      summary.completedPlanSteps = (summary.completedPlanSteps ?? 0) + 1;
      if (summary.failedPlanStep === stepId) {
        summary.failedPlanStep = undefined;
        summary.failureReason = undefined;
      }
    } else if (status === "skipped") {
      summary.skippedPlanSteps = (summary.skippedPlanSteps ?? 0) + 1;
    } else if (status === "failed") {
      summary.failedPlanStep = stepId;
      if (error && !summary.failureReason) {
        summary.failureReason = sanitizeString(error);
      }
    }
  }

  public recordFeedback(
    runId: string,
    feedback: import("../planning/types.js").ExecutionFeedback
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.feedbackCount = (summary.feedbackCount ?? 0) + 1;
    if (feedback.severity === "blocking") {
      summary.blockingFeedbackCount = (summary.blockingFeedbackCount ?? 0) + 1;
    }
  }

  public recordStepRetry(
    runId: string,
    stepId: string,
    attempt: number
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    void stepId;
    void attempt;
    summary.retryCount = (summary.retryCount ?? 0) + 1;
  }

  public recordPlanAdaptation(
    runId: string,
    reason: string,
    affectedSteps: string[]
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.adaptationCount = (summary.adaptationCount ?? 0) + 1;

    const sanitizedReason = sanitizeString(reason);
    if (!summary.planAdaptationReasons) {
      summary.planAdaptationReasons = [];
    }
    summary.planAdaptationReasons.push(sanitizedReason);

    if (!summary.blockedPlanSteps) {
      summary.blockedPlanSteps = [];
    }
    for (const s of affectedSteps) {
      if (!summary.blockedPlanSteps.includes(s)) {
        summary.blockedPlanSteps.push(s);
      }
    }
  }

  public recordDecisionRequest(
    runId: string,
    request: import("../planning/types.js").ExecutionDecisionRequest
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.decisionRequestedAt = request.requestedAt;
    summary.decisionCount = (summary.decisionCount ?? 0) + 1;
    if (request.reason && !summary.decisionReason) {
      summary.decisionReason = sanitizeString(request.reason);
    }
  }

  public recordDecisionResolution(
    runId: string,
    result: import("../planning/types.js").ExecutionDecisionResult
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.decisionResolvedAt = result.resolvedAt;
    summary.executionDecision = result.decision;
    summary.decisionOutcome = result.accepted
      ? result.cancelled
        ? "cancelled"
        : "accepted"
      : "rejected";

    if (result.resumedStepId) {
      summary.resumedFromStepId = result.resumedStepId;
      summary.resumedStepOrder = result.resumedStepOrder;
    }
    if (result.reason) {
      summary.decisionReason = sanitizeString(result.reason);
    }
  }

  public recordResumeStart(
    runId: string,
    _planId: string,
    stepId: string,
    stepOrder: number
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    void _planId;
    summary.resumedFromStepId = stepId;
    summary.resumedStepOrder = stepOrder;
  }

  public recordReconciliationStart(runId: string, _planId: string): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    void _planId;
    summary.reconciliationStartedAt = Date.now();
  }

  public recordReconciliationResult(
    runId: string,
    result: import("../planning/types.js").FinalReconciliationResult
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.reconciliationId = result.reconciliationId;
    summary.reconciliationStatus = result.status;
    summary.reconciliationCompletedAt = result.checkedAt;
    summary.expectedFileCount = result.expectedFiles.length;
    summary.modifiedFileCount = result.modifiedFiles.length;
    summary.unexpectedFileCount = result.unexpectedFiles.length;
    summary.missingFileCount = result.missingFiles.length;
    summary.reconciliationConsistent = result.consistent;
    if (result.failureReason) {
      summary.reconciliationFailureReason = sanitizeString(result.failureReason);
    }
  }

  public recordRecoveryAssessment(
    runId: string,
    assessment: import("../planning/types.js").ExecutionRecoveryAssessment
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: process.cwd(),
        userRequest: "Execution recovery"
      });
      summary = this.runSummaries.get(runId);
      if (!summary) return;
    }

    summary.lastRecoveryStrategy = assessment.strategy;
    if (assessment.reason) {
      summary.recoveryFailureReason = sanitizeString(assessment.reason);
    }
  }

  public recordRecoveryResult(
    runId: string,
    result: import("../planning/types.js").ExecutionRecoveryResult
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: process.cwd(),
        userRequest: "Execution recovery"
      });
      summary = this.runSummaries.get(runId);
      if (!summary) return;
    }

    summary.executionRecoveryCount = (summary.executionRecoveryCount || 0) + 1;
    summary.lastRecoveryStrategy = result.strategy;
    summary.lastRecoveryStatus = result.status;
    summary.lastRecoveryOutcome = result.outcome;
    summary.lastRecoveryDurationMs = result.durationMs;
    summary.repairedFiles = result.repairedFiles ? [...result.repairedFiles] : [];
    summary.lastRecoveryWorkspaceConsistent = result.workspaceConsistent;
    summary.lastRecoveryFinalPlanStatus = result.finalPlanStatus;

    if (result.completedRecoveryActions) {
      summary.lastRecoveryCompletedActions = result.completedRecoveryActions.map(
        (a) => ({ ...a })
      );
    }
    if (result.failedRecoveryActions) {
      summary.lastRecoveryFailedActions = result.failedRecoveryActions.map((f) => ({
        action: { ...f.action },
        error: sanitizeString(f.error)
      }));
    }
    if (result.blockingReasons) {
      summary.lastRecoveryBlockingReasons = result.blockingReasons.map((r) =>
        sanitizeString(r)
      );
    }

    if (result.failureReason) {
      summary.recoveryFailureReason = sanitizeString(result.failureReason);
    }

    if (!summary.recoveryLineage) {
      summary.recoveryLineage = [];
    }

    summary.recoveryLineage.push({
      recoveryId: result.recoveryId,
      parentRecoveryId: result.parentRecoveryId,
      strategy: result.strategy,
      depth: result.recoveryDepth,
      status: result.status,
      timestamp: result.completedAt
    });
  }

  public recordContinuationResult(
    runId: string,
    result: import("../planning/types.js").RecoveryContinuationResult
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: process.cwd(),
        userRequest: "Recovery continuation"
      });
      summary = this.runSummaries.get(runId);
      if (!summary) return;
    }

    summary.continuationCount = (summary.continuationCount || 0) + 1;
    summary.lastContinuationDecision = result.decision;
    summary.lastContinuationStatus = result.status;
    summary.lastContinuationDurationMs = result.durationMs;
    summary.lastContinuationResumedSteps = result.resumedStepIds
      ? [...result.resumedStepIds]
      : [];

    if (result.blockingReasons) {
      summary.lastContinuationBlockingReasons = result.blockingReasons.map((r) =>
        sanitizeString(r)
      );
    }
    if (result.failureReason) {
      summary.continuationFailureReason = sanitizeString(result.failureReason);
    }
  }

  public recordCheckpointRecord(
    runId: string,
    record: import("../checkpoints/types.js").CheckpointRecord
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: process.cwd(),
        userRequest: "Checkpoint execution"
      });
      summary = this.runSummaries.get(runId);
      if (!summary) return;
    }

    summary.checkpointRecordCount = (summary.checkpointRecordCount || 0) + 1;
    summary.lastCheckpointId = record.checkpointId;
    summary.lastCheckpointStatus = record.status;
    summary.lastCheckpointRiskLevel = record.riskLevel;
    summary.lastCheckpointReason = sanitizeString(record.reason);

    if (!summary.checkpointRecords) {
      summary.checkpointRecords = [];
    }

    const sanitizedRecord: import("../checkpoints/types.js").CheckpointRecord = {
      checkpointId: record.checkpointId,
      runId: record.runId,
      planId: record.planId,
      stepId: record.stepId,
      stepOrder: record.stepOrder,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      riskLevel: record.riskLevel,
      reason: sanitizeString(record.reason),
      affectedTargets: record.affectedTargets.map((t) => sanitizeString(t)),
      requiredAction: record.requiredAction ? sanitizeString(record.requiredAction) : undefined,
      status: record.status,
      approval: record.approval
        ? {
            ...record.approval,
            reason: record.approval.reason ? sanitizeString(record.approval.reason) : undefined
          }
        : undefined,
      consumedAt: record.consumedAt,
      invalidationReason: record.invalidationReason
        ? sanitizeString(record.invalidationReason)
        : undefined,
      branch: record.branch
    };

    const existingIdx = summary.checkpointRecords.findIndex(
      (r) => r.checkpointId === record.checkpointId
    );
    if (existingIdx >= 0) {
      summary.checkpointRecords[existingIdx] = sanitizedRecord;
    } else {
      summary.checkpointRecords.push(sanitizedRecord);
      summary.checkpointsCreated = (summary.checkpointsCreated || 0) + 1;
    }

    if (record.status === "consumed") {
      summary.checkpointsConsumed = (summary.checkpointsConsumed || 0) + 1;
    } else if (record.status === "expired") {
      summary.checkpointsExpired = (summary.checkpointsExpired || 0) + 1;
    } else if (record.status === "invalidated") {
      summary.checkpointsInvalidated = (summary.checkpointsInvalidated || 0) + 1;
    }
  }

  public recordHandoffResult(
    runId: string,
    result: import("../planning/types.js").ExecutionHandoffResult
  ): void {
    let summary = this.runSummaries.get(runId);
    if (!summary) {
      this.startRun({
        runId,
        cwd: process.cwd(),
        userRequest: "Execution handoff"
      });
      summary = this.runSummaries.get(runId);
      if (!summary) return;
    }

    summary.handoffCount = (summary.handoffCount || 0) + 1;
    summary.handoffAttempts = summary.handoffCount;
    summary.lastHandoffStatus = result.status;
    if (result.checkpointId) {
      summary.lastHandoffCheckpointId = result.checkpointId;
    }
    if (result.error) {
      summary.lastHandoffReason = sanitizeString(result.error);
    }

    if (result.status === "approved" || result.status === "consumed" || result.status === "completed") {
      summary.handoffApprovals = (summary.handoffApprovals || 0) + 1;
    } else if (result.status === "rejected") {
      summary.handoffRejections = (summary.handoffRejections || 0) + 1;
    } else if (result.status === "invalidated") {
      summary.handoffInvalidations = (summary.handoffInvalidations || 0) + 1;
    } else if (result.status === "blocked") {
      summary.handoffBlockedCount = (summary.handoffBlockedCount || 0) + 1;
      summary.handoffBlocks = summary.handoffBlockedCount;
    }
  }

  public recordToolStart(
    runId: string,
    toolName: string,
    callId: string,
    targetPath?: string
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.tools.push({
      toolName,
      callId,
      startedAt: Date.now(),
      targetPath
    });
  }

  public recordToolComplete(
    runId: string,
    callId: string,
    success: boolean,
    errorCode?: string,
    permissionOutcome?: "allowed" | "denied" | "requires_approval" | "approved"
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    const record = summary.tools.find((t) => t.callId === callId);
    if (record) {
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      record.success = success;
      record.errorCode = errorCode;
      record.permissionOutcome = permissionOutcome;
    }
  }

  public recordVerificationStart(
    runId: string,
    command: string,
    attempt: number
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.verificationAttempts = attempt;
    summary.commands.push({
      command: sanitizeString(command),
      attempt,
      startedAt: Date.now()
    });
  }

  public recordVerificationComplete(
    runId: string,
    command: string,
    attempt: number,
    succeeded: boolean,
    exitCode?: number | null,
    timedOut?: boolean
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    const record = summary.commands
      .slice()
      .reverse()
      .find((c) => c.attempt === attempt && c.command === sanitizeString(command));

    if (record) {
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      record.succeeded = succeeded;
      record.exitCode = exitCode;
      record.timedOut = timedOut;
    }
  }

  public recordRecoveryStart(
    runId: string,
    checkpointId: string,
    attempt: number
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    summary.recoveryAttempts = attempt;
    if (!summary.recovery) {
      summary.recovery = [];
    }

    summary.recovery.push({
      checkpointId,
      attempt,
      startedAt: Date.now()
    });
  }

  public recordRecoveryComplete(
    runId: string,
    checkpointId: string,
    attempt: number,
    success: boolean,
    recoveredFiles?: string[],
    preservedFiles?: string[],
    error?: string
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary || !summary.recovery) return;

    const record = summary.recovery
      .slice()
      .reverse()
      .find((r) => r.attempt === attempt && r.checkpointId === checkpointId);

    if (record) {
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      record.success = success;
      record.recoveredFiles = recoveredFiles ? [...recoveredFiles] : [];
      record.preservedFiles = preservedFiles ? [...preservedFiles] : [];
      record.error = error;
    }
  }

  public recordFileChange(
    runId: string,
    filePath: string,
    operation: "added" | "modified" | "deleted"
  ): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;

    if (operation === "added") {
      if (!summary.files.created.includes(filePath)) {
        summary.files.created.push(filePath);
      }
    } else if (operation === "deleted") {
      if (!summary.files.deleted.includes(filePath)) {
        summary.files.deleted.push(filePath);
      }
    } else {
      if (!summary.files.modified.includes(filePath)) {
        summary.files.modified.push(filePath);
      }
    }
  }

  public recordCheckpointId(runId: string, checkpointId: string): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;
    summary.checkpointId = checkpointId;
  }

  public recordSkills(runId: string, skills: string[]): void {
    const summary = this.runSummaries.get(runId);
    if (!summary) return;
    summary.activeSkills = [...skills];
  }

  public completeRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    failureReason?: string,
    failureCode?: string
  ): RunSummary | undefined {
    const summary = this.runSummaries.get(runId);
    if (!summary) return undefined;

    summary.completedAt = Date.now();
    summary.durationMs = summary.completedAt - summary.startedAt;
    summary.finalStatus = status;

    if (status === "failed") {
      summary.failureReason = failureReason;
      summary.failureCode = failureCode;
    } else if (status === "cancelled") {
      summary.cancellationReason = failureReason || "User cancelled";
    }

    return this.getRunSummary(runId);
  }

  public recordEvent(runId: string, event: AgentEvent): void {
    const events = this.runEvents.get(runId);
    if (!events) return;

    if (events.length >= this.maxEventsPerRun) {
      return;
    }

    // Do not append any events after a terminal lifecycle event
    if (events.length > 0) {
      const last = events[events.length - 1];
      if (
        last.type === "run_completed" ||
        last.type === "run_failed" ||
        last.type === "run_cancelled"
      ) {
        return;
      }
    }

    events.push(JSON.parse(JSON.stringify(event)));
  }

  public getRunSummary(runId: string): RunSummary | undefined {
    const summary = this.runSummaries.get(runId);
    if (!summary) return undefined;

    // Return defensive copy
    return JSON.parse(JSON.stringify(summary)) as RunSummary;
  }

  public getRunEvents(runId: string): AgentEvent[] | undefined {
    const events = this.runEvents.get(runId);
    if (!events) return undefined;

    return JSON.parse(JSON.stringify(events)) as AgentEvent[];
  }

  public listRuns(): RunSummary[] {
    return this.runOrder
      .map((id) => this.getRunSummary(id))
      .filter((s): s is RunSummary => Boolean(s));
  }

  public getLatestRunSummary(): RunSummary | undefined {
    if (this.runOrder.length === 0) return undefined;
    const latestId = this.runOrder[this.runOrder.length - 1];
    return this.getRunSummary(latestId);
  }

  public clear(): void {
    this.runOrder.length = 0;
    this.runSummaries.clear();
    this.runEvents.clear();
  }
}
