import type {
  ApprovalRequest,
  ToolCall,
  ToolContext,
  ToolResult
} from "@fecode/models";
import type { TaskRiskLevel } from "../policy/types.js";
import type { AgentEvent } from "../index.js";
import type {
  ExecutionFeedbackKind,
  ExecutionFeedbackManager,
  ExecutionIntent,
  PlanExecutor,
  PlanExecutorContext,
  PlanExecutorOptions,
  PlanStep,
  PlanStepExecutionResult,
  PlanVerificationResult,
  StepRetryPolicy,
  TaskPlan
} from "./types.js";
import {
  canExecuteStep,
  completePlanStep,
  failPlanStep,
  startPlanStep,
  transitionPlanStatus,
  unblockPlan
} from "./taskPlan.js";
import { detectPlanStaleness } from "./staleness.js";
import { DefaultExecutionFeedbackManager } from "./executionFeedback.js";
import { DefaultStepRetryPolicy } from "./retryPolicy.js";
import type { CommandResult } from "../commands/types.js";

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

export class DefaultPlanExecutor implements PlanExecutor {
  private readonly options: PlanExecutorOptions;
  private readonly feedbackManager: ExecutionFeedbackManager;
  private readonly retryPolicy: StepRetryPolicy;

  constructor(options: PlanExecutorOptions) {
    this.options = options;
    this.feedbackManager =
      options.feedbackManager || new DefaultExecutionFeedbackManager();
    this.retryPolicy = options.retryPolicy || new DefaultStepRetryPolicy();
  }

  public async *executePlan(
    plan: TaskPlan,
    context: PlanExecutorContext,
    options?: { isResume?: boolean; resumedFromStepId?: string }
  ): AsyncIterable<AgentEvent> {
    const startTime = Date.now();

    const isResume = Boolean(
      options?.isResume ||
      plan.status === "blocked" ||
      (plan.status === "executing" && plan.steps.some((s) => s.status === "completed"))
    );

    // 1. Approved / Blocked / Executing Plan Boundary Check
    if (
      plan.status !== "approved" &&
      plan.status !== "blocked" &&
      plan.status !== "executing"
    ) {
      const errMsg = `Only approved plans can be executed. Current status: ${plan.status}`;
      yield {
        type: "plan_execution_failed",
        runId: context.runId,
        planId: plan.planId,
        reason: errMsg,
        timestamp: Date.now()
      };
      throw new Error(errMsg);
    }

    let activePlan: TaskPlan;
    if (plan.status === "blocked") {
      activePlan = unblockPlan(plan);
    } else if (plan.status === "approved") {
      activePlan = transitionPlanStatus(plan, "executing");
    } else {
      activePlan = plan;
    }

    if (this.options.diagnosticsManager) {
      this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
    }

    yield {
      type: "plan_execution_started",
      runId: context.runId,
      planId: activePlan.planId,
      totalSteps: activePlan.steps.length,
      timestamp: Date.now()
    };

    const stepResults: PlanStepExecutionResult[] = [];
    const verificationResults: PlanVerificationResult[] = [];
    let hasFailure = false;
    let failedStepId: string | undefined;
    let failureReason: string | undefined;
    let isCancelled = false;
    let resumeEventEmitted = false;

    // Sort steps in dependency order
    const orderedSteps = [...activePlan.steps].sort(
      (a, b) => a.order - b.order
    );

    for (const step of orderedSteps) {
      // Check cancellation signal
      if (context.signal?.aborted) {
        isCancelled = true;
        break;
      }

      // If step is already completed, PRESERVE IT and DO NOT REPLAY!
      if (step.status === "completed") {
        stepResults.push({
          stepId: step.stepId,
          status: "completed",
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
          executionIntent: step.intent
        });
        continue;
      }

      // On first incomplete step during resume, emit execution_resume_started
      if (isResume && !resumeEventEmitted) {
        resumeEventEmitted = true;
        yield {
          type: "execution_resume_started",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          stepOrder: step.order,
          timestamp: Date.now()
        };
        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordResumeStart(
            context.runId,
            activePlan.planId,
            step.stepId,
            step.order
          );
        }
      }

      // 2. Check Dependency Constraints
      const depCheck = canExecuteStep(activePlan, step.stepId);
      if (!depCheck.canExecute) {
        const skipReason = depCheck.reason || "Prerequisite dependencies not satisfied";
        activePlan = failPlanStep(activePlan, step.stepId, skipReason);
        // Step marked as skipped if prior step failed or prerequisite missing
        const currentStepObj = activePlan.steps.find((s) => s.stepId === step.stepId);
        const effectiveStatus = currentStepObj?.status || "skipped";

        stepResults.push({
          stepId: step.stepId,
          status: effectiveStatus,
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
          executionIntent: step.intent,
          failureReason: skipReason
        });

        yield {
          type: "plan_step_skipped",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          stepIndex: step.order - 1,
          reason: skipReason,
          timestamp: Date.now()
        };

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.updatePlanStep(
            context.runId,
            step.stepId,
            effectiveStatus,
            skipReason
          );
        }
        continue;
      }

      // 3. Staleness Detection & Workspace Drift
      const staleness = await detectPlanStaleness(activePlan, step, {
        cwd: context.cwd,
        gitRepository: this.options.gitRepository,
        initialFingerprint: context.initialFingerprint,
        initialGitBranch: context.initialGitBranch
      });

      if (staleness.stale) {
        const staleReason = staleness.reason || "Workspace state drifted";
        failedStepId = step.stepId;
        failureReason = `PLAN_STALE: ${staleReason}`;

        const driftFb = this.feedbackManager.recordFeedback({
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          kind: "workspace_drift",
          severity: "blocking",
          summary: `Workspace drifted: ${staleReason}`,
          recommendedAction: "replan"
        });

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordFeedback(context.runId, driftFb);
        }

        yield {
          type: "execution_feedback_detected",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          feedbackId: driftFb.feedbackId,
          kind: driftFb.kind,
          severity: driftFb.severity,
          summary: driftFb.summary,
          recommendedAction: driftFb.recommendedAction,
          timestamp: Date.now()
        };

        if (isResume) {
          yield {
            type: "execution_resume_failed",
            runId: context.runId,
            planId: activePlan.planId,
            stepId: step.stepId,
            reason: staleReason,
            timestamp: Date.now()
          };
        }

        const adaptation = this.feedbackManager.assessPlanAdaptation(activePlan);
        activePlan = transitionPlanStatus(activePlan, "blocked", staleReason);

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
          this.options.diagnosticsManager.recordPlanAdaptation(
            context.runId,
            staleReason,
            adaptation.affectedSteps
          );
        }

        yield {
          type: "plan_adaptation_required",
          runId: context.runId,
          planId: activePlan.planId,
          reason: staleReason,
          affectedSteps: adaptation.affectedSteps,
          timestamp: Date.now()
        };

        yield {
          type: "plan_blocked",
          runId: context.runId,
          planId: activePlan.planId,
          blockedStepId: step.stepId,
          reason: staleReason,
          affectedSteps: adaptation.affectedSteps,
          recommendedAction: "replan",
          timestamp: Date.now()
        };
        break;
      }

      // 4. Start Step Execution
      const stepStartTime = Date.now();
      activePlan = startPlanStep(activePlan, step.stepId);
      if (this.options.diagnosticsManager) {
        this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
      }

      yield {
        type: "plan_step_started",
        runId: context.runId,
        planId: activePlan.planId,
        stepId: step.stepId,
        stepIndex: step.order - 1,
        title: step.title,
        timestamp: stepStartTime
      };

      const targetFiles = step.expectedFiles || (step.intent?.target ? [step.intent.target] : []);
      const opName = step.intent?.type || (step.type === "modify" ? "modify_file" : "inspect_file");

      let stepSuccess = false;
      let stepErrorMsg: string | undefined;
      let verificationResult: PlanVerificationResult | undefined;
      let attempt = 1;
      const maxAttempts = this.retryPolicy.maxAttempts;

      while (attempt <= maxAttempts) {
        if (context.signal?.aborted) {
          isCancelled = true;
          break;
        }

        // 5. Safety & Authoritative Risk Re-Evaluation (fresh before each attempt)
        const assessedRisk = this.options.executionPolicy.assess({
          userMessage: step.title,
          cwd: context.cwd,
          affectedFiles: targetFiles,
          operations: [opName]
        });

        const effectiveRisk = getHigherRisk(step.riskLevel, assessedRisk.level);

        // 6. Checkpoint Enforcement
        if (
          (effectiveRisk === "elevated" ||
            effectiveRisk === "critical" ||
            assessedRisk.requiresCheckpoint) &&
          this.options.checkpointManager
        ) {
          try {
            const cpRes = await this.options.checkpointManager.create({
              cwd: context.cwd,
              taskId: context.runId,
              reason:
                assessedRisk.reasons.join("; ") ||
                `Step ${step.stepId} mutation checkpoint (attempt ${attempt})`,
              affectedFiles: targetFiles,
              signal: context.signal
            });
            if (!cpRes.success) {
              stepErrorMsg = `Checkpoint creation failed: ${cpRes.error || "Unknown error"}. Mutation blocked for safety.`;
              break;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            stepErrorMsg = `Checkpoint creation failed: ${msg}. Mutation blocked for safety.`;
            break;
          }
        }

        // 7. Translate ExecutionIntent into Tool Calls & Execute (FRESH checks on every attempt)
        const toolCall = this.translateIntentToToolCall(step);
        let attemptSuccess = true;
        let attemptErrorMsg: string | undefined;

        if (toolCall) {
          const tool = this.options.registry.get(toolCall.name);
          if (!tool) {
            attemptSuccess = false;
            attemptErrorMsg = `Tool not found in registry: ${toolCall.name}`;
          } else {
            const toolContext: ToolContext = {
              cwd: context.cwd,
              signal: context.signal || new AbortController().signal
            };

            const permissionDecision = await this.options.permissionManager.check(
              tool,
              toolContext
            );

            if (permissionDecision.type === "denied") {
              attemptSuccess = false;
              attemptErrorMsg = permissionDecision.reason || "Permission denied";
            } else if (permissionDecision.type === "requires_approval") {
              const approvalRequest: ApprovalRequest = {
                id: `approval-${step.stepId}-${attempt}-${Date.now()}`,
                toolName: tool.name,
                category: tool.permissionCategory || "write",
                arguments: toolCall.arguments,
                reason:
                  permissionDecision.reason ||
                  `Approval required for step ${step.stepId} attempt ${attempt} (${step.title})`
              };

              yield {
                type: "plan_step_waiting_approval",
                runId: context.runId,
                planId: activePlan.planId,
                stepId: step.stepId,
                request: approvalRequest,
                timestamp: Date.now()
              };

              yield {
                type: "approval_required",
                request: approvalRequest
              };

              let approvalOutcome = false;
              if (this.options.approvalResolver) {
                const decision = await this.options.approvalResolver.resolve(
                  approvalRequest
                );
                if (decision.approved) {
                  approvalOutcome = true;
                } else {
                  approvalOutcome = false;
                  attemptErrorMsg =
                    decision.reason || "Tool execution was denied by user.";
                }
              } else {
                attemptErrorMsg =
                  "Approval required but no ApprovalResolver configured.";
              }

              if (!approvalOutcome) {
                attemptSuccess = false;
              }
            }

            if (attemptSuccess) {
              const toolExecResult: ToolResult = await this.options.executor.execute(
                toolCall,
                toolContext
              );
              yield {
                type: "tool_result",
                result: toolExecResult,
                callId: toolCall.id
              };

              if (!toolExecResult.success) {
                attemptSuccess = false;
                attemptErrorMsg =
                  toolExecResult.error?.message ||
                  "Tool execution failed without explicit error";
              }
            }
          }
        }

        // 8. Perform Verification if Required
        if (attemptSuccess && step.verificationRequired) {
          const vCmd =
            step.intent?.command ||
            (activePlan.verificationStrategy &&
            activePlan.verificationStrategy.length > 0
              ? activePlan.verificationStrategy[0]
              : "npm test");

          const vStartTime = Date.now();
          if (context.onStateTransition) {
            yield* context.onStateTransition(
              "verifying",
              `Verifying step ${step.stepId} attempt ${attempt}: ${vCmd}`
            );
          }

          let cmdResult: CommandResult | undefined;
          if (this.options.commandExecutor) {
            cmdResult = await this.options.commandExecutor.execute(vCmd, {
              cwd: context.cwd,
              signal: context.signal
            });
          }

          const vDuration = Date.now() - vStartTime;
          const vSucceeded =
            cmdResult !== undefined
              ? cmdResult.exitCode === 0 && !cmdResult.timedOut && !cmdResult.error
              : true;

          verificationResult = {
            stepId: step.stepId,
            command: vCmd,
            succeeded: vSucceeded,
            exitCode: cmdResult?.exitCode,
            output: cmdResult?.stdout || cmdResult?.stderr,
            durationMs: vDuration,
            timedOut: cmdResult?.timedOut
          };
          verificationResults.push(verificationResult);

          if (this.options.diagnosticsManager) {
            this.options.diagnosticsManager.recordVerificationStart(
              context.runId,
              vCmd,
              attempt
            );
            this.options.diagnosticsManager.recordVerificationComplete(
              context.runId,
              vCmd,
              attempt,
              vSucceeded,
              cmdResult?.exitCode ?? (vSucceeded ? 0 : 1),
              Boolean(cmdResult?.timedOut)
            );
          }

          if (!vSucceeded) {
            attemptSuccess = false;
            attemptErrorMsg = `Verification failed for command '${vCmd}' (exit code ${cmdResult?.exitCode ?? "non-zero"})`;
          }
        }

        if (attemptSuccess) {
          stepSuccess = true;
          stepErrorMsg = undefined;
          if (attempt > 1) {
            yield {
              type: "step_retry_completed",
              runId: context.runId,
              planId: activePlan.planId,
              stepId: step.stepId,
              attempt,
              success: true,
              timestamp: Date.now()
            };
          }
          break;
        }

        // Attempt failed
        stepErrorMsg = attemptErrorMsg || "Step execution attempt failed";
        const failureKind: ExecutionFeedbackKind =
          verificationResult && !verificationResult.succeeded
            ? "verification_failed"
            : "tool_failure";

        const canRetryThisStep = this.retryPolicy.canRetry(
          step,
          attempt,
          failureKind,
          opName
        );

        if (canRetryThisStep) {
          const warnFb = this.feedbackManager.recordFeedback({
            runId: context.runId,
            planId: activePlan.planId,
            stepId: step.stepId,
            kind: failureKind,
            severity: "warning",
            summary: `Step ${step.stepId} attempt ${attempt} failed (${stepErrorMsg}), scheduling retry...`,
            recommendedAction: "retry"
          });

          if (this.options.diagnosticsManager) {
            this.options.diagnosticsManager.recordFeedback(context.runId, warnFb);
            this.options.diagnosticsManager.recordStepRetry(
              context.runId,
              step.stepId,
              attempt + 1
            );
          }

          yield {
            type: "execution_feedback_detected",
            runId: context.runId,
            planId: activePlan.planId,
            stepId: step.stepId,
            feedbackId: warnFb.feedbackId,
            kind: warnFb.kind,
            severity: warnFb.severity,
            summary: warnFb.summary,
            recommendedAction: warnFb.recommendedAction,
            timestamp: Date.now()
          };

          yield {
            type: "step_retry_started",
            runId: context.runId,
            planId: activePlan.planId,
            stepId: step.stepId,
            attempt: attempt + 1,
            maxAttempts,
            reason: stepErrorMsg,
            timestamp: Date.now()
          };

          attempt++;
        } else {
          // Non-retryable failure or attempts exhausted
          if (attempt > 1) {
            yield {
              type: "step_retry_completed",
              runId: context.runId,
              planId: activePlan.planId,
              stepId: step.stepId,
              attempt,
              success: false,
              error: stepErrorMsg,
              timestamp: Date.now()
            };
          }
          break;
        }
      }

      // 9. Step Completion or Failure Update
      const stepDuration = Date.now() - stepStartTime;
      if (stepSuccess) {
        activePlan = completePlanStep(activePlan, step.stepId);
        stepResults.push({
          stepId: step.stepId,
          status: "completed",
          startedAt: stepStartTime,
          completedAt: Date.now(),
          durationMs: stepDuration,
          executionIntent: step.intent,
          verification: verificationResult
        });

        const okFb = this.feedbackManager.recordFeedback({
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          kind: "step_completed",
          severity: "info",
          summary: `Step ${step.stepId} completed successfully`,
          recommendedAction: "continue"
        });

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordFeedback(context.runId, okFb);
        }

        yield {
          type: "execution_feedback_detected",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          feedbackId: okFb.feedbackId,
          kind: okFb.kind,
          severity: okFb.severity,
          summary: okFb.summary,
          recommendedAction: okFb.recommendedAction,
          timestamp: Date.now()
        };

        yield {
          type: "plan_step_completed",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          stepIndex: step.order - 1,
          durationMs: stepDuration,
          timestamp: Date.now()
        };

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.updatePlanStep(
            context.runId,
            step.stepId,
            "completed"
          );
        }
      } else {
        hasFailure = true;
        failedStepId = step.stepId;
        failureReason = stepErrorMsg || "Step execution failed";
        activePlan = failPlanStep(activePlan, step.stepId, failureReason);

        stepResults.push({
          stepId: step.stepId,
          status: "failed",
          startedAt: stepStartTime,
          completedAt: Date.now(),
          durationMs: stepDuration,
          executionIntent: step.intent,
          verification: verificationResult,
          failureReason
        });

        const blockingFb = this.feedbackManager.recordFeedback({
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          kind: "step_failed",
          severity: "blocking",
          summary: `Step ${step.stepId} failed: ${failureReason}`,
          recommendedAction: "replan"
        });

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordFeedback(context.runId, blockingFb);
        }

        yield {
          type: "execution_feedback_detected",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          feedbackId: blockingFb.feedbackId,
          kind: blockingFb.kind,
          severity: blockingFb.severity,
          summary: blockingFb.summary,
          recommendedAction: blockingFb.recommendedAction,
          timestamp: Date.now()
        };

        yield {
          type: "plan_step_failed",
          runId: context.runId,
          planId: activePlan.planId,
          stepId: step.stepId,
          stepIndex: step.order - 1,
          error: failureReason,
          durationMs: stepDuration,
          timestamp: Date.now()
        };

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.updatePlanStep(
            context.runId,
            step.stepId,
            "failed",
            failureReason
          );
        }

        // Assess adaptation & block the plan
        const adaptation = this.feedbackManager.assessPlanAdaptation(activePlan);
        activePlan = transitionPlanStatus(activePlan, "blocked", failureReason);

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
          this.options.diagnosticsManager.recordPlanAdaptation(
            context.runId,
            failureReason,
            adaptation.affectedSteps
          );
        }

        yield {
          type: "plan_adaptation_required",
          runId: context.runId,
          planId: activePlan.planId,
          reason: failureReason,
          affectedSteps: adaptation.affectedSteps,
          timestamp: Date.now()
        };

        yield {
          type: "plan_blocked",
          runId: context.runId,
          planId: activePlan.planId,
          blockedStepId: step.stepId,
          reason: failureReason,
          affectedSteps: adaptation.affectedSteps,
          recommendedAction: adaptation.recommendedAction,
          timestamp: Date.now()
        };

        break;
      }
    }

    // 10. Finalize Plan Status & Emit Summary Events
    const totalDuration = Date.now() - startTime;
    const completedCount = activePlan.steps.filter(
      (s) => s.status === "completed"
    ).length;

    if (isCancelled) {
      activePlan = transitionPlanStatus(activePlan, "cancelled");
      if (this.options.diagnosticsManager) {
        this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
      }
      yield {
        type: "plan_execution_cancelled",
        runId: context.runId,
        planId: activePlan.planId,
        reason: "Plan execution cancelled by user or signal",
        timestamp: Date.now()
      };
      return;
    }

    if (activePlan.status === "blocked") {
      // Plan is in blocked state, requiring user decision (Continue / Replan / Cancel)
      return;
    }

    if (hasFailure) {
      activePlan = transitionPlanStatus(activePlan, "failed");
      if (this.options.diagnosticsManager) {
        this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
      }
      yield {
        type: "plan_execution_failed",
        runId: context.runId,
        planId: activePlan.planId,
        failedStep: failedStepId,
        reason: failureReason,
        timestamp: Date.now()
      };
      return;
    }

    if (completedCount === activePlan.steps.length) {
      activePlan = transitionPlanStatus(activePlan, "completed");
      if (this.options.diagnosticsManager) {
        this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
      }

      if (isResume) {
        yield {
          type: "execution_resume_completed",
          runId: context.runId,
          planId: activePlan.planId,
          completedSteps: completedCount,
          totalSteps: activePlan.steps.length,
          timestamp: Date.now()
        };
      }

      yield {
        type: "plan_execution_completed",
        runId: context.runId,
        planId: activePlan.planId,
        completedSteps: completedCount,
        totalSteps: activePlan.steps.length,
        durationMs: totalDuration,
        timestamp: Date.now()
      };
    }
  }

  public async *resumePlan(
    plan: TaskPlan,
    context: PlanExecutorContext,
    options: { resumedFromStepId?: string } = {}
  ): AsyncIterable<AgentEvent> {
    yield* this.executePlan(plan, context, {
      isResume: true,
      resumedFromStepId: options.resumedFromStepId
    });
  }

  /**
   * Helper to translate ExecutionIntent into standard tool calls.
   */
  private translateIntentToToolCall(
    step: PlanStep
  ): ToolCall | null {
    const intent: ExecutionIntent | undefined = step.intent;
    const callId = `call-${step.stepId}-${Date.now()}`;

    if (!intent) {
      if (step.type === "inspect") {
        return {
          id: callId,
          name: "read_file",
          arguments: {
            path: step.expectedFiles?.[0] || "README.md"
          }
        };
      }
      if (step.type === "test" || step.type === "verify") {
        return {
          id: callId,
          name: "execute_command",
          arguments: {
            command: "npm test"
          }
        };
      }
      return null;
    }

    switch (intent.type) {
      case "inspect_file":
        return {
          id: callId,
          name: "read_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || ""
          }
        };

      case "inspect_directory":
        return {
          id: callId,
          name: "list_directory",
          arguments: {
            path: intent.target || "."
          }
        };

      case "search_code":
        return {
          id: callId,
          name: "search_files",
          arguments: {
            query: intent.reason || step.title
          }
        };

      case "modify_file":
        return {
          id: callId,
          name: "edit_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || "",
            oldText: "",
            newText: ""
          }
        };

      case "create_file":
        return {
          id: callId,
          name: "write_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || "",
            content: ""
          }
        };

      case "delete_file":
        return {
          id: callId,
          name: "delete_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || ""
          }
        };

      case "execute_command":
      case "run_tests":
      case "verify_changes":
        return {
          id: callId,
          name: "execute_command",
          arguments: {
            command: intent.command || "npm test"
          }
        };

      default:
        return null;
    }
  }
}
