import type {
  ContinuationStatus,
  ExecutionRecoveryResult,
  PlanStatus,
  PlanStep,
  RecoveryContinuationManager,
  RecoveryContinuationManagerOptions,
  RecoveryContinuationPreparation,
  RecoveryContinuationRequest,
  RecoveryContinuationResult,
  RecoveryOutcomeStatus,
  TaskPlan
} from "./types.js";
import type { AgentEvent } from "../index.js";
import { transitionPlanStatus } from "./taskPlan.js";
import { detectPlanStaleness } from "./staleness.js";

function generateContinuationId(): string {
  return `cont-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

export class DefaultRecoveryContinuationManager
  implements RecoveryContinuationManager
{
  private readonly options: RecoveryContinuationManagerOptions;
  private readonly history = new Map<string, RecoveryContinuationResult[]>();

  constructor(options: RecoveryContinuationManagerOptions) {
    this.options = options;
  }

  public async prepareContinuation(
    plan: TaskPlan,
    options: {
      cwd: string;
      recoveryResult?: ExecutionRecoveryResult;
      recoveryOutcome?: RecoveryOutcomeStatus;
      userRequest?: string;
    }
  ): Promise<RecoveryContinuationPreparation> {
    const outcome: RecoveryOutcomeStatus =
      options.recoveryOutcome ||
      options.recoveryResult?.outcome ||
      (plan.status === "completed" ? "recovered" : "still_blocked");

    const completedSteps: PlanStep[] = plan.steps.filter(
      (s) => s.status === "completed"
    );
    const skippedSteps: PlanStep[] = plan.steps.filter(
      (s) => s.status === "skipped"
    );
    const remainingSteps: PlanStep[] = plan.steps.filter(
      (s) => s.status !== "completed" && s.status !== "skipped"
    );

    // Rule: Terminal or invalid plan status prevents continuation
    if (
      plan.status === "superseded" ||
      plan.status === "cancelled" ||
      plan.status === "failed"
    ) {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reconciliationConsistent: false,
        reason: `Plan is in terminal status '${plan.status}'. Continuation is forbidden.`,
        requiresExplicitApproval: true
      };
    }

    // Rule: still_blocked, failed, or cancelled recovery outcomes forbid continuation
    if (outcome === "still_blocked") {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reconciliationConsistent: false,
        reason: "Recovery is still blocked; continuation is forbidden.",
        requiresExplicitApproval: true
      };
    }

    if (outcome === "failed") {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reconciliationConsistent: false,
        reason: "Recovery failed; continuation is forbidden.",
        requiresExplicitApproval: true
      };
    }

    if (outcome === "cancelled") {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reconciliationConsistent: false,
        reason: "Recovery was cancelled; continuation is forbidden.",
        requiresExplicitApproval: true
      };
    }

    // Rule: No remaining steps -> complete plan without unnecessary continuation prompt
    if (remainingSteps.length === 0) {
      if (plan.status !== "completed") {
        try {
          const updated = transitionPlanStatus(plan, "completed");
          plan.status = updated.status;
        } catch {
          // ignore
        }
      }
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps: [],
        completedSteps,
        skippedSteps,
        reconciliationConsistent: true,
        reason: "All plan steps are already completed.",
        requiresExplicitApproval: false
      };
    }

    // Reconciliation Gate
    let reconciliationConsistent = true;
    let reconciliationFailureReason: string | undefined;

    try {
      const recon = await this.options.reconciler.reconcile({
        runId: plan.runId,
        plan,
        cwd: options.cwd,
        gitRepository: this.options.gitRepository,
        verificationPassed: true
      });
      reconciliationConsistent = recon.consistent;
      if (!recon.consistent) {
        reconciliationFailureReason =
          recon.failureReason || "Workspace reconciliation failed before continuation";
      }
    } catch (err: unknown) {
      reconciliationConsistent = false;
      reconciliationFailureReason =
        err instanceof Error ? err.message : String(err);
    }

    if (!reconciliationConsistent) {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reconciliationConsistent: false,
        reconciliationFailureReason,
        reason: `Reconciliation gate failed: ${reconciliationFailureReason}`,
        requiresExplicitApproval: true
      };
    }

    // Re-evaluate task risk
    let reassessedRisk;
    try {
      reassessedRisk = this.options.executionPolicy.assess({
        userMessage: options.userRequest || plan.userRequestSummary,
        cwd: options.cwd,
        affectedFiles: remainingSteps.flatMap((s) => s.expectedFiles || []),
        operations: remainingSteps.map((s) => s.type)
      });
    } catch {
      // fallback
    }

    // Re-evaluate skills
    let reassessedSkills: string[] | undefined;
    if (this.options.skillRegistry && this.options.activationPolicy) {
      try {
        const activated = this.options.activationPolicy.activate(
          options.userRequest || plan.userRequestSummary,
          this.options.skillRegistry
        );
        reassessedSkills = activated.skills.map((s) => s.name);
      } catch {
        // ignore
      }
    }

    // Re-check plan staleness
    let staleness: import("./types.js").PlanStalenessResult | undefined;
    for (const step of remainingSteps) {
      try {
        const s = await detectPlanStaleness(plan, step, {
          cwd: options.cwd,
          gitRepository: this.options.gitRepository
        });
        if (s.stale) {
          staleness = s;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (staleness && staleness.stale) {
      return {
        eligible: false,
        canContinue: false,
        planId: plan.planId,
        runId: plan.runId,
        recoveryOutcome: outcome,
        remainingSteps,
        completedSteps,
        skippedSteps,
        reassessedRisk,
        reassessedSkills,
        reconciliationConsistent: true,
        staleness,
        reason: `Plan is stale: ${staleness.reason || "Stale workspace detected"}`,
        requiresExplicitApproval: true
      };
    }

    return {
      eligible: true,
      canContinue: true,
      planId: plan.planId,
      runId: plan.runId,
      recoveryOutcome: outcome,
      remainingSteps,
      completedSteps,
      skippedSteps,
      reassessedRisk,
      reassessedSkills,
      reconciliationConsistent: true,
      staleness,
      requiresExplicitApproval: true
    };
  }

  public async *executeContinuation(
    plan: TaskPlan,
    preparation: RecoveryContinuationPreparation,
    request: RecoveryContinuationRequest
  ): AsyncIterable<AgentEvent> {
    const continuationId = generateContinuationId();
    const startTime = Date.now();
    const runId = request.runId || plan.runId;
    const startingPlanStatus: PlanStatus = plan.status;

    yield {
      type: "recovery_continuation_requested",
      runId,
      planId: plan.planId,
      timestamp: startTime
    };

    yield {
      type: "recovery_continuation_prepared",
      runId,
      planId: plan.planId,
      preparation,
      timestamp: Date.now()
    };

    // 1. User declined or cancelled continuation
    if (
      request.decision === "cancel" ||
      request.approved === false ||
      request.signal?.aborted
    ) {
      let finalPlanStatus: PlanStatus = plan.status;
      try {
        if (plan.status === "executing") {
          const updated = transitionPlanStatus(plan, "cancelled");
          plan.status = updated.status;
          finalPlanStatus = updated.status;
        }
      } catch {
        finalPlanStatus = plan.status;
      }

      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "cancel",
        status: "cancelled",
        startingPlanStatus,
        finalPlanStatus,
        resumedStepIds: [],
        completedStepIds: preparation.completedSteps.map((s) => s.stepId),
        skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
        cancellationReason:
          request.reason ||
          (request.signal?.aborted
            ? "Continuation cancelled by signal"
            : "Continuation cancelled by user"),
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      yield {
        type: "recovery_continuation_cancelled",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        reason: result.cancellationReason || "Continuation cancelled",
        timestamp: Date.now()
      };
      return;
    }

    // 2. User chose replan
    if (request.decision === "replan") {
      if (!this.options.replanManager) {
        const result: RecoveryContinuationResult = Object.freeze({
          continuationId,
          runId,
          planId: plan.planId,
          recoveryOutcome: preparation.recoveryOutcome,
          decision: "replan",
          status: "failed",
          startingPlanStatus,
          finalPlanStatus: plan.status,
          resumedStepIds: [],
          completedStepIds: preparation.completedSteps.map((s) => s.stepId),
          skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
          failureReason: "ReplanManager is not configured",
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime
        });

        this.recordResult(plan.planId, result);

        yield {
          type: "recovery_continuation_failed",
          continuationId,
          runId,
          planId: plan.planId,
          result,
          reason: "ReplanManager is not configured",
          timestamp: Date.now()
        };
        return;
      }

      const replanResult = await this.options.replanManager.executeReplan({
        runId,
        previousPlanId: plan.planId,
        reason: request.reason || "Recovery continuation replan requested",
        cwd: request.cwd,
        userRequest: plan.userRequestSummary,
        requestedBy: "user"
      });

      let finalPlanStatus: PlanStatus = plan.status;
      if (replanResult.status === "created") {
        try {
          const updated = transitionPlanStatus(plan, "superseded");
          plan.status = updated.status;
          finalPlanStatus = "superseded";
        } catch {
          // ignore
        }
      }

      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "replan",
        status: replanResult.status === "created" ? "completed" : "failed",
        startingPlanStatus,
        finalPlanStatus,
        resumedStepIds: [],
        completedStepIds: preparation.completedSteps.map((s) => s.stepId),
        skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
        failureReason:
          replanResult.status !== "created" ? replanResult.reason : undefined,
        replanResult,
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      if (replanResult.status === "created") {
        yield {
          type: "recovery_continuation_completed",
          continuationId,
          runId,
          planId: plan.planId,
          result,
          timestamp: Date.now()
        };
      } else {
        yield {
          type: "recovery_continuation_failed",
          continuationId,
          runId,
          planId: plan.planId,
          result,
          reason: replanResult.reason || "Replan failed",
          timestamp: Date.now()
        };
      }
      return;
    }

    // 3. User chose continue
    // Gate validation check
    if (!preparation.canContinue) {
      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "continue",
        status: "blocked",
        startingPlanStatus,
        finalPlanStatus: plan.status,
        resumedStepIds: [],
        completedStepIds: preparation.completedSteps.map((s) => s.stepId),
        skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
        blockingReasons: [preparation.reason || "Continuation is not eligible"],
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      yield {
        type: "recovery_continuation_blocked",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        blockingReasons: result.blockingReasons || [],
        timestamp: Date.now()
      };
      return;
    }

    // Re-check reconciliation gate before execution
    let gateRecon;
    try {
      gateRecon = await this.options.reconciler.reconcile({
        runId,
        plan,
        cwd: request.cwd,
        gitRepository: this.options.gitRepository,
        verificationPassed: true
      });
    } catch (err: unknown) {
      gateRecon = {
        consistent: false,
        failureReason: err instanceof Error ? err.message : String(err)
      };
    }

    if (!gateRecon.consistent) {
      try {
        if (plan.status !== "blocked") {
          const updated = transitionPlanStatus(plan, "blocked");
          plan.status = updated.status;
        }
      } catch {
        // ignore
      }

      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "continue",
        status: "blocked",
        startingPlanStatus,
        finalPlanStatus: plan.status,
        resumedStepIds: [],
        completedStepIds: preparation.completedSteps.map((s) => s.stepId),
        skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
        blockingReasons: [
          gateRecon.failureReason ||
            "Workspace reconciliation gate failed before continuation"
        ],
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      yield {
        type: "recovery_continuation_blocked",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        blockingReasons: result.blockingReasons || [],
        timestamp: Date.now()
      };
      return;
    }

    // Check staleness before executing
    let staleness: import("./types.js").PlanStalenessResult | undefined;
    for (const step of preparation.remainingSteps) {
      try {
        const s = await detectPlanStaleness(plan, step, {
          cwd: request.cwd,
          gitRepository: this.options.gitRepository
        });
        if (s.stale) {
          staleness = s;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (staleness && staleness.stale) {
      try {
        if (plan.status !== "blocked") {
          const updated = transitionPlanStatus(plan, "blocked");
          plan.status = updated.status;
        }
      } catch {
        // ignore
      }

      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "continue",
        status: "blocked",
        startingPlanStatus,
        finalPlanStatus: plan.status,
        resumedStepIds: [],
        completedStepIds: preparation.completedSteps.map((s) => s.stepId),
        skippedStepIds: preparation.skippedSteps.map((s) => s.stepId),
        blockingReasons: [
          `Plan is stale: ${staleness.reason || "Stale workspace detected"}`
        ],
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      yield {
        type: "recovery_continuation_blocked",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        blockingReasons: result.blockingReasons || [],
        timestamp: Date.now()
      };
      return;
    }

    // Gates passed! Transition plan to executing
    try {
      if (plan.status === "blocked" || plan.status === "approved" || plan.status === "failed") {
        const updated = transitionPlanStatus(plan, "executing");
        plan.status = updated.status;
      }
    } catch {
      // ignore
    }

    // Reset remaining non-completed steps to pending
    const remainingStepIdSet = new Set(preparation.remainingSteps.map((s) => s.stepId));
    plan.steps = plan.steps.map((s) => {
      if (remainingStepIdSet.has(s.stepId) && s.status !== "completed") {
        return {
          ...s,
          status: "pending",
          error: undefined
        };
      }
      return s;
    });

    const resumedStepIds = preparation.remainingSteps.map((s) => s.stepId);

    yield {
      type: "recovery_continuation_started",
      continuationId,
      runId,
      planId: plan.planId,
      resumedStepIds,
      timestamp: Date.now()
    };

    // Execute remaining steps via existing PlanExecutor
    try {
      const executorOptions = {
        isResume: true,
        resumedFromStepId: preparation.remainingSteps[0]?.stepId
      };

      for await (const ev of this.options.planExecutor.executePlan(
        plan,
        {
          runId,
          cwd: request.cwd,
          signal: request.signal
        },
        executorOptions
      )) {
        yield ev;

        if (ev.type === "plan_execution_completed") {
          plan.status = "completed";
        } else if (ev.type === "plan_execution_failed") {
          plan.status = "failed";
        } else if (ev.type === "plan_execution_cancelled") {
          plan.status = "cancelled";
        } else if (ev.type === "plan_blocked") {
          plan.status = "blocked";
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const result: RecoveryContinuationResult = Object.freeze({
        continuationId,
        runId,
        planId: plan.planId,
        recoveryOutcome: preparation.recoveryOutcome,
        decision: "continue",
        status: plan.status === "cancelled" ? "cancelled" : "failed",
        startingPlanStatus,
        finalPlanStatus: plan.status,
        resumedStepIds,
        completedStepIds: plan.steps
          .filter((s) => s.status === "completed")
          .map((s) => s.stepId),
        skippedStepIds: plan.steps
          .filter((s) => s.status === "skipped")
          .map((s) => s.stepId),
        failureReason: errMsg,
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime
      });

      this.recordResult(plan.planId, result);

      if (plan.status === "cancelled" || request.signal?.aborted) {
        yield {
          type: "recovery_continuation_cancelled",
          continuationId,
          runId,
          planId: plan.planId,
          result,
          reason: errMsg,
          timestamp: Date.now()
        };
      } else {
        yield {
          type: "recovery_continuation_failed",
          continuationId,
          runId,
          planId: plan.planId,
          result,
          reason: errMsg,
          timestamp: Date.now()
        };
      }
      return;
    }

    const completedStepIds = plan.steps
      .filter((s) => s.status === "completed")
      .map((s) => s.stepId);
    const skippedStepIds = plan.steps
      .filter((s) => s.status === "skipped")
      .map((s) => s.stepId);

    const continuationStatus: ContinuationStatus =
      plan.status === "completed"
        ? "completed"
        : plan.status === "blocked"
          ? "blocked"
          : plan.status === "cancelled"
            ? "cancelled"
            : "failed";

    const result: RecoveryContinuationResult = Object.freeze({
      continuationId,
      runId,
      planId: plan.planId,
      recoveryOutcome: preparation.recoveryOutcome,
      decision: "continue",
      status: continuationStatus,
      startingPlanStatus,
      finalPlanStatus: plan.status,
      resumedStepIds,
      completedStepIds,
      skippedStepIds,
      startedAt: startTime,
      completedAt: Date.now(),
      durationMs: Date.now() - startTime
    });

    this.recordResult(plan.planId, result);

    if (continuationStatus === "completed") {
      yield {
        type: "recovery_continuation_completed",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        timestamp: Date.now()
      };
    } else if (continuationStatus === "blocked") {
      yield {
        type: "recovery_continuation_blocked",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        blockingReasons: ["Remaining steps were blocked during execution"],
        timestamp: Date.now()
      };
    } else if (continuationStatus === "cancelled") {
      yield {
        type: "recovery_continuation_cancelled",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        reason: "Continuation cancelled",
        timestamp: Date.now()
      };
    } else {
      yield {
        type: "recovery_continuation_failed",
        continuationId,
        runId,
        planId: plan.planId,
        result,
        reason: "Continuation failed during step execution",
        timestamp: Date.now()
      };
    }
  }

  public getContinuationHistory(
    planId: string
  ): RecoveryContinuationResult[] {
    const list = this.history.get(planId) || [];
    return [...list];
  }

  private recordResult(
    planId: string,
    result: RecoveryContinuationResult
  ): void {
    if (!this.history.has(planId)) {
      this.history.set(planId, []);
    }
    this.history.get(planId)!.push(result);
  }
}
