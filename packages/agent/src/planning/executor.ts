import type {
  ApprovalRequest,
  ToolCall,
  ToolContext,
  ToolResult
} from "@fecode/models";
import type { TaskRiskLevel } from "../policy/types.js";
import type { AgentEvent } from "../index.js";
import type {
  ExecutionIntent,
  PlanExecutor,
  PlanExecutorContext,
  PlanExecutorOptions,
  PlanStep,
  PlanStepExecutionResult,
  PlanVerificationResult,
  TaskPlan
} from "./types.js";
import {
  canExecuteStep,
  completePlanStep,
  failPlanStep,
  invalidatePlan,
  startPlanStep,
  transitionPlanStatus
} from "./taskPlan.js";
import { detectPlanStaleness } from "./staleness.js";
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

  constructor(options: PlanExecutorOptions) {
    this.options = options;
  }

  public async *executePlan(
    plan: TaskPlan,
    context: PlanExecutorContext
  ): AsyncIterable<AgentEvent> {
    const startTime = Date.now();

    // 1. Approved Plan Boundary Check
    if (plan.status !== "approved") {
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

    let activePlan: TaskPlan = transitionPlanStatus(plan, "executing");
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
    let isSuperseded = false;

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

      // 3. Staleness Detection
      const staleness = await detectPlanStaleness(activePlan, step, {
        cwd: context.cwd,
        gitRepository: this.options.gitRepository,
        initialFingerprint: context.initialFingerprint,
        initialGitBranch: context.initialGitBranch
      });

      if (staleness.stale) {
        isSuperseded = true;
        const staleReason = staleness.reason || "Workspace state drifted";
        activePlan = invalidatePlan(activePlan, staleReason);
        failureReason = `PLAN_STALE: ${staleReason}`;
        failedStepId = step.stepId;

        if (this.options.diagnosticsManager) {
          this.options.diagnosticsManager.recordPlan(context.runId, activePlan);
        }

        yield {
          type: "plan_execution_failed",
          runId: context.runId,
          planId: activePlan.planId,
          failedStep: step.stepId,
          reason: failureReason,
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

      // 5. Safety & Authoritative Risk Re-Evaluation
      const targetFiles = step.expectedFiles || (step.intent?.target ? [step.intent.target] : []);
      const opName = step.intent?.type || (step.type === "modify" ? "modify_file" : "inspect_file");
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
              `Step ${step.stepId} mutation checkpoint`,
            affectedFiles: targetFiles,
            signal: context.signal
          });
          if (!cpRes.success) {
            hasFailure = true;
            failedStepId = step.stepId;
            failureReason = `Checkpoint creation failed: ${cpRes.error || "Unknown error"}. Mutation blocked for safety.`;
            activePlan = failPlanStep(activePlan, step.stepId, failureReason);

            const durationMs = Date.now() - stepStartTime;
            stepResults.push({
              stepId: step.stepId,
              status: "failed",
              startedAt: stepStartTime,
              completedAt: Date.now(),
              durationMs,
              executionIntent: step.intent,
              failureReason
            });

            yield {
              type: "plan_step_failed",
              runId: context.runId,
              planId: activePlan.planId,
              stepId: step.stepId,
              stepIndex: step.order - 1,
              error: failureReason,
              durationMs,
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
            break;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          hasFailure = true;
          failedStepId = step.stepId;
          failureReason = `Checkpoint creation failed: ${msg}. Mutation blocked for safety.`;
          activePlan = failPlanStep(activePlan, step.stepId, failureReason);

          const durationMs = Date.now() - stepStartTime;
          stepResults.push({
            stepId: step.stepId,
            status: "failed",
            startedAt: stepStartTime,
            completedAt: Date.now(),
            durationMs,
            executionIntent: step.intent,
            failureReason
          });

          yield {
            type: "plan_step_failed",
            runId: context.runId,
            planId: activePlan.planId,
            stepId: step.stepId,
            stepIndex: step.order - 1,
            error: failureReason,
            durationMs,
            timestamp: Date.now()
          };
          break;
        }
      }

      // 7. Translate ExecutionIntent into Tool Calls & Execute
      const toolCall = this.translateIntentToToolCall(step);
      let stepSuccess = true;
      let stepErrorMsg: string | undefined;

      if (toolCall) {
        const tool = this.options.registry.get(toolCall.name);
        if (!tool) {
          stepSuccess = false;
          stepErrorMsg = `Tool not found in registry: ${toolCall.name}`;
        } else {
          const toolContext: ToolContext = {
            cwd: context.cwd,
            signal: context.signal || new AbortController().signal
          };

          // Check permissions
          const permissionDecision = await this.options.permissionManager.check(
            tool,
            toolContext
          );

          if (permissionDecision.type === "denied") {
            stepSuccess = false;
            stepErrorMsg = permissionDecision.reason || "Permission denied";
          } else if (permissionDecision.type === "requires_approval") {
            const approvalRequest: ApprovalRequest = {
              id: `approval-${step.stepId}-${Date.now()}`,
              toolName: tool.name,
              category: tool.permissionCategory || "write",
              arguments: toolCall.arguments,
              reason:
                permissionDecision.reason ||
                `Approval required for step ${step.stepId} (${step.title})`
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
                if (!stepErrorMsg) {
                  stepErrorMsg =
                    decision.reason || "Tool execution was denied by user.";
                }
              }
            } else {
              stepErrorMsg = "Approval required but no ApprovalResolver configured.";
            }

            if (!approvalOutcome) {
              stepSuccess = false;
            }
          }

          if (stepSuccess) {
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
              stepSuccess = false;
              stepErrorMsg =
                toolExecResult.error?.message ||
                "Tool execution failed without explicit error";
            }
          }
        }
      }

      // 8. Perform Verification if Required
      let verificationResult: PlanVerificationResult | undefined;
      if (stepSuccess && step.verificationRequired) {
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
            `Verifying step ${step.stepId}: ${vCmd}`
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
            1
          );
          this.options.diagnosticsManager.recordVerificationComplete(
            context.runId,
            vCmd,
            1,
            vSucceeded,
            cmdResult?.exitCode ?? (vSucceeded ? 0 : 1),
            Boolean(cmdResult?.timedOut)
          );
        }

        if (!vSucceeded) {
          stepSuccess = false;
          stepErrorMsg = `Verification failed for command '${vCmd}' (exit code ${cmdResult?.exitCode ?? "non-zero"})`;
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

        // Dependent steps will be blocked on subsequent iterations
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

    if (isSuperseded) {
      // Plan was marked superseded during staleness detection
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
