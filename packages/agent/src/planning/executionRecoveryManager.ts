import * as fs from "fs/promises";
import * as path from "path";
import type {
  ExecutionRecoveryAssessment,
  ExecutionRecoveryManager,
  ExecutionRecoveryManagerOptions,
  ExecutionRecoveryOptions,
  ExecutionRecoveryRequest,
  ExecutionRecoveryResult,
  FailedRecoveryAction,
  PlanStatus,
  PlanVerificationResult,
  RecoveryOutcomeStatus,
  RecoveryStrategy,
  RepairAction,
  TaskPlan
} from "./types.js";
import { transitionPlanStatus } from "./taskPlan.js";
import type { AgentEvent } from "../index.js";
import type { TaskRiskLevel } from "../policy/types.js";

const RISK_LEVEL_ORDER: Record<TaskRiskLevel, number> = {
  low: 1,
  normal: 2,
  elevated: 3,
  critical: 4
};

function getHigherRisk(a: TaskRiskLevel, b: TaskRiskLevel): TaskRiskLevel {
  const orderA = RISK_LEVEL_ORDER[a] ?? 2;
  const orderB = RISK_LEVEL_ORDER[b] ?? 2;
  return orderA >= orderB ? a : b;
}

function getPlanHighestRisk(plan: TaskPlan): TaskRiskLevel {
  let highest: TaskRiskLevel = "normal";
  for (const step of plan.steps) {
    if (step.riskLevel) {
      highest = getHigherRisk(highest, step.riskLevel);
    }
  }
  return highest;
}

export class DefaultExecutionRecoveryManager implements ExecutionRecoveryManager {
  private readonly options: ExecutionRecoveryManagerOptions;
  private readonly maxRecoveryDepth: number;
  private readonly recoveryHistory: Map<string, ExecutionRecoveryResult[]> = new Map();
  private readonly recoveryResults: Map<string, ExecutionRecoveryResult> = new Map();
  private readonly recoveryLineages: Map<string, string> = new Map();

  constructor(options: ExecutionRecoveryManagerOptions) {
    this.options = options;
    this.maxRecoveryDepth = options.maxRecoveryDepth ?? 5;
  }

  public async assessRecovery(
    plan: TaskPlan,
    options: ExecutionRecoveryOptions
  ): Promise<ExecutionRecoveryAssessment> {
    const parentId = options.parentRecoveryId;
    let recoveryDepth = 0;

    if (parentId) {
      const parentResult = this.recoveryResults.get(parentId);
      if (parentResult) {
        recoveryDepth = (parentResult.recoveryDepth ?? 0) + 1;
      } else {
        recoveryDepth = 1;
      }
    }

    const planRisk = getPlanHighestRisk(plan);

    if (recoveryDepth >= this.maxRecoveryDepth) {
      return Object.freeze({
        eligible: false,
        strategy: "cancel",
        riskLevel: planRisk,
        riskReasons: ["Maximum recovery depth reached"],
        workspaceDrift: false,
        affectedSteps: options.affectedSteps || [],
        affectedFiles: options.affectedFiles || [],
        requiresExplicitApproval: true,
        reason: `Maximum recovery depth reached (${recoveryDepth}/${this.maxRecoveryDepth})`,
        recoveryDepth,
        maxRecoveryDepth: this.maxRecoveryDepth,
        isLimitReached: true
      });
    }

    const recon = options.reconciliationResult;
    let strategy: RecoveryStrategy = options.strategy || "recheck";
    let strategyReason = options.reason || "Recovery assessment required";
    let workspaceDrift = false;
    const affectedFiles: string[] = [...(options.affectedFiles || [])];
    const repairActions: RepairAction[] = [];

    if (!options.strategy) {
      if (recon) {
        if (recon.branchChanged) {
          strategy = "replan";
          strategyReason = "Git branch changed during execution; replanning is required.";
          workspaceDrift = true;
        } else if (recon.unexpectedFiles.length > 0) {
          strategy = "replan";
          strategyReason = `Unexpected workspace modifications detected (${recon.unexpectedFiles.join(", ")}); replanning is required.`;
          workspaceDrift = true;
          for (const f of recon.unexpectedFiles) {
            if (!affectedFiles.includes(f)) affectedFiles.push(f);
          }
        } else if (recon.missingFiles.length > 0) {
          let allRepairable = true;
          for (const missingFile of recon.missingFiles) {
            if (!affectedFiles.includes(missingFile)) affectedFiles.push(missingFile);
            const step = plan.steps.find(
              (s) =>
                s.expectedFiles?.includes(missingFile) ||
                s.intent?.target === missingFile
            );
            if (step) {
              repairActions.push({
                target: missingFile,
                operation:
                  step.intent?.type === "create_file"
                    ? "create_file"
                    : step.intent?.type === "modify_file"
                      ? "modify_file"
                      : "restore_file",
                content: step.intent?.expectedChange || "",
                reason: `Repair missing expected file: ${missingFile}`
              });
            } else {
              allRepairable = false;
            }
          }

          if (allRepairable && repairActions.length > 0) {
            strategy = "repair";
            strategyReason = `Bounded repair available for missing expected files (${recon.missingFiles.join(", ")})`;
          } else {
            strategy = "replan";
            strategyReason = `Missing expected files cannot be safely repaired automatically (${recon.missingFiles.join(", ")}); replanning is required.`;
          }
        } else if (!recon.verificationPassed) {
          strategy = "recheck";
          strategyReason = "Verification checks failed; re-evaluating workspace state.";
        }
      } else if (
        options.reason?.toLowerCase().includes("drift") ||
        options.reason?.toLowerCase().includes("stale")
      ) {
        strategy = "replan";
        strategyReason = options.reason;
        workspaceDrift = true;
      }
    }

    const assessedRisk = this.options.executionPolicy.assess({
      userMessage: strategyReason,
      cwd: options.cwd,
      affectedFiles,
      operations: strategy === "repair" ? ["repair", "write_file"] : ["recheck"]
    });

    const effectiveRisk = getHigherRisk(planRisk, assessedRisk.level);

    return Object.freeze({
      eligible: true,
      strategy,
      riskLevel: effectiveRisk,
      riskReasons: assessedRisk.reasons,
      workspaceDrift,
      affectedSteps: options.affectedSteps || [],
      affectedFiles,
      requiresExplicitApproval: true,
      reason: strategyReason,
      recoveryDepth,
      maxRecoveryDepth: this.maxRecoveryDepth,
      isLimitReached: false,
      repairActions: repairActions.length > 0 ? repairActions : undefined,
      reconciliationResult: recon
    });
  }

  public async *executeRecovery(
    plan: TaskPlan,
    assessment: ExecutionRecoveryAssessment,
    options: ExecutionRecoveryOptions
  ): AsyncIterable<AgentEvent> {
    const startTime = Date.now();
    const recoveryId = `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const runId = plan.runId || `run-${Date.now()}`;

    if (options.parentRecoveryId) {
      this.recoveryLineages.set(recoveryId, options.parentRecoveryId);
    }

    yield {
      type: "recovery_assessment_started",
      runId,
      planId: plan.planId,
      timestamp: startTime
    };

    yield {
      type: "recovery_assessment_completed",
      assessment,
      timestamp: Date.now()
    };

    if (!options.approved) {
      const request: ExecutionRecoveryRequest = Object.freeze({
        recoveryId,
        runId,
        planId: plan.planId,
        requestedBy: "user",
        strategy: assessment.strategy,
        reason: assessment.reason,
        affectedSteps: assessment.affectedSteps,
        affectedFiles: assessment.affectedFiles,
        requestedAt: Date.now(),
        parentRecoveryId: options.parentRecoveryId,
        recoveryDepth: assessment.recoveryDepth
      });

      yield {
        type: "recovery_waiting_approval",
        request,
        assessment,
        timestamp: Date.now()
      };

      const blockedResult: ExecutionRecoveryResult = Object.freeze({
        recoveryId,
        runId,
        planId: plan.planId,
        strategy: assessment.strategy,
        status: "blocked",
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
        affectedSteps: assessment.affectedSteps,
        repairedFiles: [],
        failureReason: "Recovery requires explicit user approval",
        parentRecoveryId: options.parentRecoveryId,
        recoveryDepth: assessment.recoveryDepth
      });

      this.recordResult(plan.planId, blockedResult);

      yield {
        type: "recovery_blocked",
        result: blockedResult,
        reason: "Recovery requires explicit user approval",
        timestamp: Date.now()
      };
      return;
    }

    if (options.signal?.aborted) {
      const cancelResult: ExecutionRecoveryResult = Object.freeze({
        recoveryId,
        runId,
        planId: plan.planId,
        strategy: assessment.strategy,
        status: "cancelled",
        outcome: "cancelled",
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
        affectedSteps: [...assessment.affectedSteps],
        completedRecoveryActions: [],
        failedRecoveryActions: [],
        repairedFiles: [],
        workspaceConsistent: false,
        finalPlanStatus: plan.status,
        cancellationReason: "Recovery cancelled by signal",
        failureReason: "Recovery cancelled by signal",
        parentRecoveryId: options.parentRecoveryId,
        recoveryDepth: assessment.recoveryDepth
      });

      this.recordResult(plan.planId, cancelResult);

      yield {
        type: "recovery_outcome_determined",
        recoveryId,
        runId,
        planId: plan.planId,
        outcome: "cancelled",
        result: cancelResult,
        timestamp: Date.now()
      };

      yield {
        type: "recovery_cancelled",
        recoveryId,
        runId,
        planId: plan.planId,
        reason: "Recovery cancelled by signal",
        timestamp: Date.now()
      };
      return;
    }

    yield {
      type: "recovery_started",
      recoveryId,
      runId,
      planId: plan.planId,
      strategy: assessment.strategy,
      timestamp: Date.now()
    };

    const completedRecoveryActions: RepairAction[] = [];
    const failedRecoveryActions: FailedRecoveryAction[] = [];
    const repairedFiles: string[] = [];

    if (assessment.strategy === "cancel") {
      try {
        transitionPlanStatus(plan, "cancelled");
      } catch {
        // ignore
      }

      const cancelResult: ExecutionRecoveryResult = Object.freeze({
        recoveryId,
        runId,
        planId: plan.planId,
        strategy: "cancel",
        status: "cancelled",
        outcome: "cancelled",
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
        affectedSteps: [...assessment.affectedSteps],
        completedRecoveryActions: [],
        failedRecoveryActions: [],
        repairedFiles: [],
        workspaceConsistent: false,
        finalPlanStatus: plan.status,
        cancellationReason: options.reason || "Recovery cancelled by user request",
        parentRecoveryId: options.parentRecoveryId,
        recoveryDepth: assessment.recoveryDepth
      });

      this.recordResult(plan.planId, cancelResult);

      yield {
        type: "recovery_outcome_determined",
        recoveryId,
        runId,
        planId: plan.planId,
        outcome: "cancelled",
        result: cancelResult,
        timestamp: Date.now()
      };

      yield {
        type: "recovery_cancelled",
        recoveryId,
        runId,
        planId: plan.planId,
        reason: options.reason || "Recovery cancelled by user request",
        timestamp: Date.now()
      };
      return;
    }

    if (assessment.strategy === "replan") {
      if (!this.options.replanManager) {
        const failedResult: ExecutionRecoveryResult = Object.freeze({
          recoveryId,
          runId,
          planId: plan.planId,
          strategy: "replan",
          status: "failed",
          outcome: "failed",
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime,
          affectedSteps: [...assessment.affectedSteps],
          completedRecoveryActions: [],
          failedRecoveryActions: [],
          repairedFiles: [],
          workspaceConsistent: false,
          finalPlanStatus: "failed",
          failureReason: "ReplanManager is not configured",
          parentRecoveryId: options.parentRecoveryId,
          recoveryDepth: assessment.recoveryDepth
        });

        this.recordResult(plan.planId, failedResult);

        yield {
          type: "recovery_outcome_determined",
          recoveryId,
          runId,
          planId: plan.planId,
          outcome: "failed",
          result: failedResult,
          timestamp: Date.now()
        };

        yield {
          type: "recovery_failed",
          result: failedResult,
          reason: "ReplanManager is not configured",
          timestamp: Date.now()
        };
        return;
      }
      const replanResult = await this.options.replanManager.executeReplan({
        runId,
        previousPlanId: plan.planId,
        reason: assessment.reason,
        cwd: options.cwd,
        userRequest: options.userRequest || plan.userRequestSummary,
        requestedBy: "user"
      });

      const outcome: RecoveryOutcomeStatus =
        replanResult.status === "created" ? "recovered" : "failed";

      let finalPlanStatus: PlanStatus = plan.status;
      if (replanResult.status === "created") {
        try {
          const updated = transitionPlanStatus(plan, "superseded");
          plan.status = updated.status;
          finalPlanStatus = "superseded";
        } catch {
          // ignore
        }
      } else {
        try {
          const updated = transitionPlanStatus(plan, "failed");
          plan.status = updated.status;
          finalPlanStatus = "failed";
        } catch {
          // ignore
        }
      }

      const recoveryRes: ExecutionRecoveryResult = Object.freeze({
        recoveryId,
        runId,
        planId: plan.planId,
        strategy: "replan",
        status: outcome === "recovered" ? "completed" : "failed",
        outcome,
        startedAt: startTime,
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
        affectedSteps: [...assessment.affectedSteps],
        completedRecoveryActions: [],
        failedRecoveryActions: [],
        repairedFiles: [],
        replanResult,
        workspaceConsistent: replanResult.status === "created",
        finalPlanStatus,
        failureReason: replanResult.status !== "created" ? replanResult.reason : undefined,
        parentRecoveryId: options.parentRecoveryId,
        recoveryDepth: assessment.recoveryDepth
      });

      this.recordResult(plan.planId, recoveryRes);

      yield {
        type: "recovery_outcome_determined",
        recoveryId,
        runId,
        planId: plan.planId,
        outcome,
        result: recoveryRes,
        timestamp: Date.now()
      };

      if (replanResult.status === "created") {
        yield {
          type: "recovery_completed",
          result: recoveryRes,
          timestamp: Date.now()
        };
      } else {
        yield {
          type: "recovery_failed",
          result: recoveryRes,
          reason: replanResult.reason || "Replanning failed",
          timestamp: Date.now()
        };
      }
      return;
    }

    if (assessment.strategy === "repair" && assessment.repairActions) {
      let stepIdx = 1;
      const totalSteps = assessment.repairActions.length;

      for (const action of assessment.repairActions) {
        if (options.signal?.aborted) {
          failedRecoveryActions.push({
            action: { ...action },
            error: "Action cancelled by abort signal"
          });
          break;
        }

        yield {
          type: "recovery_step_started",
          recoveryId,
          stepIndex: stepIdx,
          totalSteps,
          title: `Repair ${action.target}`,
          timestamp: Date.now()
        };

        const targetFullPath = path.isAbsolute(action.target)
          ? action.target
          : path.join(options.cwd, action.target);

        try {
          this.options.executionPolicy.assess({
            userMessage: `Repair ${action.target}`,
            cwd: options.cwd,
            affectedFiles: [action.target],
            operations: ["repair", "write_file"]
          });

          await fs.mkdir(path.dirname(targetFullPath), { recursive: true });
          await fs.writeFile(targetFullPath, action.content || "", "utf-8");

          completedRecoveryActions.push({ ...action });
          repairedFiles.push(action.target);

          yield {
            type: "recovery_step_completed",
            recoveryId,
            stepIndex: stepIdx,
            totalSteps,
            title: `Repair ${action.target}`,
            success: true,
            timestamp: Date.now()
          };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          failedRecoveryActions.push({
            action: { ...action },
            error: errMsg
          });

          yield {
            type: "recovery_step_completed",
            recoveryId,
            stepIndex: stepIdx,
            totalSteps,
            title: `Repair ${action.target}`,
            success: false,
            timestamp: Date.now()
          };
        }
        stepIdx++;
      }
    }

    let verificationResult: PlanVerificationResult | undefined;
    let verificationPassed = true;

    if (this.options.commandExecutor) {
      const vCmd = "npm test";
      yield {
        type: "recovery_verification_started",
        recoveryId,
        command: vCmd,
        timestamp: Date.now()
      };

      const vStart = Date.now();
      try {
        const cmdRes = await this.options.commandExecutor.execute(vCmd, {
          cwd: options.cwd
        });
        const success = cmdRes.exitCode === 0;
        verificationPassed = success;
        verificationResult = {
          planId: plan.planId,
          stepId: "recovery-verification",
          command: vCmd,
          succeeded: success,
          success,
          exitCode: cmdRes.exitCode,
          durationMs: Date.now() - vStart,
          failureReason: !success
            ? `Command exited with code ${cmdRes.exitCode}`
            : undefined
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        verificationPassed = false;
        verificationResult = {
          planId: plan.planId,
          stepId: "recovery-verification",
          command: vCmd,
          succeeded: false,
          success: false,
          exitCode: 1,
          durationMs: Date.now() - vStart,
          failureReason: errMsg
        };
      }

      yield {
        type: "recovery_verification_completed",
        recoveryId,
        command: vCmd,
        success: verificationPassed,
        timestamp: Date.now()
      };
    }

    yield {
      type: "recovery_reconciliation_started",
      recoveryId,
      timestamp: Date.now()
    };

    const reconResult = await this.options.reconciler.reconcile({
      runId,
      plan,
      cwd: options.cwd,
      gitRepository: this.options.gitRepository,
      verificationPassed
    });

    yield {
      type: "recovery_reconciliation_completed",
      recoveryId,
      result: reconResult,
      timestamp: Date.now()
    };

    let outcome: RecoveryOutcomeStatus;
    const blockingReasons: string[] = [];

    if (options.signal?.aborted) {
      outcome = "cancelled";
    } else if (verificationPassed && reconResult.consistent) {
      if (
        reconResult.workspaceChanged ||
        reconResult.changedFiles.length > 0 ||
        failedRecoveryActions.length > 0
      ) {
        outcome = "recovered_with_changes";
      } else {
        outcome = "recovered";
      }
    } else {
      outcome = "still_blocked";
      if (!verificationPassed) {
        blockingReasons.push(
          verificationResult?.failureReason || "Verification checks failed"
        );
      }
      if (!reconResult.consistent && reconResult.failureReason) {
        blockingReasons.push(reconResult.failureReason);
      }
      for (const f of failedRecoveryActions) {
        blockingReasons.push(
          `Failed to repair ${f.action.target}: ${f.error}`
        );
      }
    }

    let finalPlanStatus: PlanStatus = plan.status;
    if (outcome === "recovered" || outcome === "recovered_with_changes") {
      const allStepsDone = plan.steps.every(
        (s) => s.status === "completed" || s.status === "skipped"
      );
      if (allStepsDone) {
        try {
          const updated = transitionPlanStatus(plan, "completed");
          plan.status = updated.status;
          finalPlanStatus = "completed";
        } catch {
          // ignore
        }
      } else {
        try {
          const updated = transitionPlanStatus(plan, "executing");
          plan.status = updated.status;
          finalPlanStatus = "executing";
        } catch {
          // ignore
        }
      }
    } else if (outcome === "still_blocked") {
      try {
        if (plan.status !== "blocked") {
          const updated = transitionPlanStatus(plan, "blocked");
          plan.status = updated.status;
        }
        finalPlanStatus = "blocked";
      } catch {
        finalPlanStatus = plan.status;
      }
    } else if (outcome === "cancelled") {
      try {
        const updated = transitionPlanStatus(plan, "cancelled");
        plan.status = updated.status;
        finalPlanStatus = "cancelled";
      } catch {
        finalPlanStatus = plan.status;
      }
    } else if (outcome === "failed") {
      try {
        const updated = transitionPlanStatus(plan, "failed");
        plan.status = updated.status;
        finalPlanStatus = "failed";
      } catch {
        finalPlanStatus = plan.status;
      }
    }

    const finalResult: ExecutionRecoveryResult = Object.freeze({
      recoveryId,
      runId,
      planId: plan.planId,
      strategy: assessment.strategy,
      status:
        outcome === "recovered" || outcome === "recovered_with_changes"
          ? "completed"
          : outcome === "still_blocked"
            ? "blocked"
            : outcome,
      outcome,
      startedAt: startTime,
      completedAt: Date.now(),
      durationMs: Date.now() - startTime,
      affectedSteps: [...assessment.affectedSteps],
      completedRecoveryActions: [...completedRecoveryActions],
      failedRecoveryActions: failedRecoveryActions.map((f) => ({
        action: { ...f.action },
        error: f.error
      })),
      repairedFiles: [...repairedFiles],
      verificationResult: verificationResult ? { ...verificationResult } : undefined,
      reconciliationResult: reconResult,
      workspaceConsistent: reconResult.consistent,
      finalPlanStatus,
      failureReason:
        outcome !== "recovered" && outcome !== "recovered_with_changes"
          ? blockingReasons[0] || reconResult.failureReason
          : undefined,
      blockingReasons: blockingReasons.length > 0 ? [...blockingReasons] : undefined,
      parentRecoveryId: options.parentRecoveryId,
      recoveryDepth: assessment.recoveryDepth
    });

    this.recordResult(plan.planId, finalResult);

    yield {
      type: "recovery_outcome_determined",
      recoveryId,
      runId,
      planId: plan.planId,
      outcome,
      result: finalResult,
      timestamp: Date.now()
    };

    if (outcome === "recovered" || outcome === "recovered_with_changes") {
      yield {
        type: "recovery_completed",
        result: finalResult,
        timestamp: Date.now()
      };
    } else if (outcome === "still_blocked") {
      yield {
        type: "recovery_still_blocked",
        recoveryId,
        planId: plan.planId,
        result: finalResult,
        blockingReasons,
        timestamp: Date.now()
      };
      yield {
        type: "recovery_blocked",
        result: finalResult,
        reason: blockingReasons.join("; ") || "Recovery remains blocked",
        timestamp: Date.now()
      };
    } else if (outcome === "cancelled") {
      yield {
        type: "recovery_cancelled",
        recoveryId,
        runId,
        planId: plan.planId,
        reason: options.reason || "Recovery cancelled",
        timestamp: Date.now()
      };
    } else {
      yield {
        type: "recovery_failed",
        result: finalResult,
        reason: finalResult.failureReason || "Recovery failed",
        timestamp: Date.now()
      };
    }
  }

  private recordResult(planId: string, result: ExecutionRecoveryResult): void {
    this.recoveryResults.set(result.recoveryId, result);
    const list = this.recoveryHistory.get(planId) || [];
    list.push(result);
    this.recoveryHistory.set(planId, list);
  }

  public getRecoveryHistory(planId: string): ExecutionRecoveryResult[] {
    return [...(this.recoveryHistory.get(planId) || [])];
  }

  public getRecoveryLineage(recoveryId: string): ExecutionRecoveryResult[] {
    const lineage: ExecutionRecoveryResult[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = recoveryId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const res = this.recoveryResults.get(currentId);
      if (!res) break;
      lineage.push(res);
      currentId = this.recoveryLineages.get(currentId) || res.parentRecoveryId;
    }

    return lineage;
  }
}
