import type {
  ApprovalRequest,
  ToolCall,
  ToolContext,
  ToolResult
} from "@fecode/models";
import type { TaskRiskLevel } from "../policy/types.js";
import type { AgentEvent } from "../index.js";
import type {
  ExecutionHandoffContext,
  ExecutionHandoffManager,
  ExecutionHandoffManagerOptions,
  ExecutionHandoffPreparation,
  ExecutionHandoffResult,
  PlanStep
} from "./types.js";
import type { CheckpointRecord } from "../checkpoints/types.js";

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

export class DefaultExecutionHandoffManager implements ExecutionHandoffManager {
  private readonly options: ExecutionHandoffManagerOptions;

  constructor(options: ExecutionHandoffManagerOptions) {
    this.options = options;
  }

  public async prepareHandoff(
    context: ExecutionHandoffContext
  ): Promise<ExecutionHandoffPreparation> {
    const step = context.step;
    const targetFiles =
      step.expectedFiles || (step.intent?.target ? [step.intent.target] : []);
    const opName =
      step.intent?.type ||
      (step.type === "modify" ? "modify_file" : "inspect_file");

    const assessedRisk = this.options.executionPolicy.assess({
      userMessage: step.title,
      cwd: context.cwd,
      affectedFiles: targetFiles,
      operations: [opName]
    });

    const effectiveRisk = getHigherRisk(step.riskLevel, assessedRisk.level);
    const requiresCheckpoint =
      effectiveRisk === "elevated" ||
      effectiveRisk === "critical" ||
      assessedRisk.requiresCheckpoint;
    const requiresExplicitApproval =
      requiresCheckpoint || assessedRisk.requiresExplicitApproval;

    const toolCall = this.translateIntentToToolCall(step);

    return {
      canExecute: true,
      requiresCheckpoint,
      requiresExplicitApproval,
      effectiveRisk,
      riskReasons: [...assessedRisk.reasons],
      toolCall
    };
  }

  public async *executeHandoff(
    context: ExecutionHandoffContext
  ): AsyncGenerator<AgentEvent, ExecutionHandoffResult, void> {
    const step = context.step;

    if (context.signal?.aborted) {
      return {
        success: false,
        status: "cancelled",
        error: "Execution cancelled before handoff."
      };
    }

    const prep = await this.prepareHandoff(context);
    const targetFiles =
      step.expectedFiles || (step.intent?.target ? [step.intent.target] : []);

    yield {
      type: "execution_handoff_started",
      runId: context.runId,
      planId: context.planId,
      stepId: step.stepId,
      riskLevel: prep.effectiveRisk,
      timestamp: Date.now()
    };

    let cpRecord: CheckpointRecord | undefined;

    // 1. Checkpoint Creation & Approval Request if required
    if (prep.requiresCheckpoint && this.options.checkpointManager) {
      try {
        const cpRes = await this.options.checkpointManager.create({
          cwd: context.cwd,
          taskId: context.runId,
          reason:
            prep.riskReasons.join("; ") ||
            `Step ${step.stepId} mutation checkpoint`,
          affectedFiles: targetFiles,
          signal: context.signal
        });

        if (!cpRes.success) {
          const err = `Checkpoint creation failed: ${cpRes.error || "Unknown error"}. Mutation blocked for safety.`;
          yield {
            type: "execution_handoff_blocked",
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            blockers: [err],
            timestamp: Date.now()
          };
          return {
            success: false,
            status: "blocked",
            error: err,
            blockers: [err]
          };
        }

        if (this.options.checkpointManager.requestApproval) {
          cpRecord = await this.options.checkpointManager.requestApproval({
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            stepOrder: step.order,
            riskLevel: prep.effectiveRisk,
            reason:
              prep.riskReasons.join("; ") ||
              `Step ${step.stepId} mutation checkpoint`,
            affectedTargets: targetFiles,
            requiredAction: step.title,
            cwd: context.cwd
          });

          yield {
            type: "checkpoint_created",
            checkpointId: cpRecord.checkpointId,
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            riskLevel: prep.effectiveRisk,
            reason: cpRecord.reason,
            affectedTargets: targetFiles,
            timestamp: Date.now()
          };

          yield {
            type: "checkpoint_approval_requested",
            checkpointId: cpRecord.checkpointId,
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            stepOrder: step.order,
            riskLevel: prep.effectiveRisk,
            reason: cpRecord.reason,
            affectedTargets: targetFiles,
            requiredAction: step.title,
            expiresAt: cpRecord.expiresAt,
            timestamp: Date.now()
          };

          yield {
            type: "execution_handoff_waiting_approval",
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            checkpointId: cpRecord.checkpointId,
            riskLevel: prep.effectiveRisk,
            reason: cpRecord.reason,
            affectedTargets: targetFiles,
            timestamp: Date.now()
          };

          if (this.options.diagnosticsManager) {
            this.options.diagnosticsManager.recordCheckpointRecord(
              context.runId,
              cpRecord
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const blockerMsg = `Checkpoint creation error: ${msg}`;
        yield {
          type: "execution_handoff_blocked",
          runId: context.runId,
          planId: context.planId,
          stepId: step.stepId,
          blockers: [blockerMsg],
          timestamp: Date.now()
        };
        return {
          success: false,
          status: "blocked",
          error: blockerMsg,
          blockers: [blockerMsg]
        };
      }

      // 2. Explicit User Approval Boundary
      if (prep.requiresExplicitApproval && this.options.approvalResolver) {
        const approvalRequest: ApprovalRequest = {
          id: `approval-${step.stepId}-${Date.now()}`,
          toolName: prep.toolCall?.name || step.type,
          category: "write",
          arguments: { stepId: step.stepId, targetFiles },
          reason:
            prep.riskReasons.join("; ") ||
            `Approval required for step ${step.stepId} (${step.title})`
        };

        const decision = await this.options.approvalResolver.resolve(
          approvalRequest
        );

        if (decision.approved) {
          if (cpRecord && this.options.checkpointManager.approve) {
            const approvedRecord = await this.options.checkpointManager.approve(
              cpRecord.checkpointId,
              {
                approved: true,
                approvedBy: "user",
                decision: "approved",
                timestamp: Date.now()
              }
            );
            if (this.options.diagnosticsManager) {
              this.options.diagnosticsManager.recordCheckpointRecord(
                context.runId,
                approvedRecord
              );
            }
          }

          if (cpRecord) {
            yield {
              type: "checkpoint_approved",
              checkpointId: cpRecord.checkpointId,
              runId: context.runId,
              planId: context.planId,
              stepId: step.stepId,
              approvedBy: "user",
              timestamp: Date.now()
            };

            yield {
              type: "execution_handoff_approved",
              runId: context.runId,
              planId: context.planId,
              stepId: step.stepId,
              checkpointId: cpRecord.checkpointId,
              approvedBy: "user",
              timestamp: Date.now()
            };

            // 3. Validate & Single-Use Checkpoint Consumption
            if (this.options.checkpointManager.consume) {
              const consumeRes = await this.options.checkpointManager.consume(
                cpRecord.checkpointId,
                {
                  runId: context.runId,
                  planId: context.planId,
                  stepId: step.stepId,
                  riskLevel: prep.effectiveRisk,
                  cwd: context.cwd,
                  gitRepository: this.options.gitRepository
                }
              );

              if (!consumeRes.success) {
                yield {
                  type: "checkpoint_invalidated",
                  checkpointId: cpRecord.checkpointId,
                  runId: context.runId,
                  planId: context.planId,
                  stepId: step.stepId,
                  reason:
                    consumeRes.error ||
                    "Checkpoint approval invalidated before consumption",
                  timestamp: Date.now()
                };

                yield {
                  type: "execution_handoff_invalidated",
                  runId: context.runId,
                  planId: context.planId,
                  stepId: step.stepId,
                  checkpointId: cpRecord.checkpointId,
                  reason:
                    consumeRes.error ||
                    "Checkpoint approval invalidated before consumption",
                  timestamp: Date.now()
                };

                return {
                  success: false,
                  status: "invalidated",
                  checkpointId: cpRecord.checkpointId,
                  error: consumeRes.error
                };
              }

              yield {
                type: "checkpoint_consumed",
                checkpointId: cpRecord.checkpointId,
                runId: context.runId,
                planId: context.planId,
                stepId: step.stepId,
                consumedAt: consumeRes.consumedAt || Date.now(),
                timestamp: Date.now()
              };

              yield {
                type: "execution_handoff_consumed",
                runId: context.runId,
                planId: context.planId,
                stepId: step.stepId,
                checkpointId: cpRecord.checkpointId,
                consumedAt: consumeRes.consumedAt || Date.now(),
                timestamp: Date.now()
              };
            }
          }
        } else {
          if (cpRecord && this.options.checkpointManager.reject) {
            const rejectedRecord = await this.options.checkpointManager.reject(
              cpRecord.checkpointId,
              decision.reason
            );
            if (this.options.diagnosticsManager) {
              this.options.diagnosticsManager.recordCheckpointRecord(
                context.runId,
                rejectedRecord
              );
            }
          }

          if (cpRecord) {
            yield {
              type: "checkpoint_rejected",
              checkpointId: cpRecord.checkpointId,
              runId: context.runId,
              planId: context.planId,
              stepId: step.stepId,
              reason: decision.reason,
              timestamp: Date.now()
            };
          }

          yield {
            type: "execution_handoff_rejected",
            runId: context.runId,
            planId: context.planId,
            stepId: step.stepId,
            checkpointId: cpRecord?.checkpointId || "unknown",
            reason: decision.reason,
            timestamp: Date.now()
          };

          return {
            success: false,
            status: "rejected",
            checkpointId: cpRecord?.checkpointId,
            error: decision.reason || "Approval rejected by user."
          };
        }
      }
    }

    // 4. Translate and Execute Tool
    const toolCall = prep.toolCall || this.translateIntentToToolCall(step);
    if (!toolCall) {
      // Non-tool step
      yield {
        type: "execution_handoff_completed",
        runId: context.runId,
        planId: context.planId,
        stepId: step.stepId,
        status: "completed",
        timestamp: Date.now()
      };
      return {
        success: true,
        status: "completed",
        checkpointId: cpRecord?.checkpointId
      };
    }

    const tool = this.options.registry.get(toolCall.name);
    if (!tool) {
      const err = `Tool not found in registry: ${toolCall.name}`;
      yield {
        type: "execution_handoff_completed",
        runId: context.runId,
        planId: context.planId,
        stepId: step.stepId,
        status: "failed",
        timestamp: Date.now()
      };
      return {
        success: false,
        status: "failed",
        error: err
      };
    }

    const toolContext: ToolContext = {
      cwd: context.cwd,
      signal: context.signal || new AbortController().signal
    };

    const permissionDecision = await this.options.permissionManager.check(
      tool,
      toolContext
    );

    if (permissionDecision.type === "denied") {
      const err = permissionDecision.reason || "Permission denied";
      yield {
        type: "execution_handoff_completed",
        runId: context.runId,
        planId: context.planId,
        stepId: step.stepId,
        status: "failed",
        timestamp: Date.now()
      };
      return {
        success: false,
        status: "failed",
        error: err
      };
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
        planId: context.planId,
        stepId: step.stepId,
        request: approvalRequest,
        timestamp: Date.now()
      };

      yield {
        type: "approval_required",
        request: approvalRequest
      };

      let approvalOutcome = false;
      let attemptErrorMsg: string | undefined;

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
        yield {
          type: "execution_handoff_completed",
          runId: context.runId,
          planId: context.planId,
          stepId: step.stepId,
          status: "failed",
          timestamp: Date.now()
        };
        return {
          success: false,
          status: "failed",
          error: attemptErrorMsg
        };
      }
    }

    const toolExecResult: ToolResult = await this.options.executor.execute(
      toolCall,
      toolContext
    );

    yield {
      type: "tool_result",
      result: toolExecResult,
      callId: toolCall.id
    };

    const finalStatus = toolExecResult.success ? "completed" : "failed";
    yield {
      type: "execution_handoff_completed",
      runId: context.runId,
      planId: context.planId,
      stepId: step.stepId,
      status: finalStatus,
      timestamp: Date.now()
    };

    return {
      success: toolExecResult.success,
      status: finalStatus,
      checkpointId: cpRecord?.checkpointId,
      toolResult: toolExecResult,
      error: toolExecResult.success
        ? undefined
        : toolExecResult.error?.message || "Tool execution failed"
    };
  }

  private translateIntentToToolCall(step: PlanStep): ToolCall | undefined {
    const callId = `call-${step.stepId}-${Date.now()}`;
    if (!step.intent) {
      if (step.type === "inspect") {
        return {
          id: callId,
          name: "read_file",
          arguments: {
            path: step.expectedFiles?.[0] || "index.ts"
          }
        };
      }
      if (step.type === "modify") {
        return {
          id: callId,
          name: "edit_file",
          arguments: {
            path: step.expectedFiles?.[0] || "index.ts"
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
      return undefined;
    }

    const intent = step.intent;
    switch (intent.type) {
      case "inspect_file":
        return {
          id: callId,
          name: "read_file",
          arguments: { path: intent.target || step.expectedFiles?.[0] || "index.ts" }
        };
      case "inspect_directory":
        return {
          id: callId,
          name: "list_directory",
          arguments: { path: intent.target || "." }
        };
      case "search_code":
        return {
          id: callId,
          name: "search_files",
          arguments: { pattern: intent.target || "", query: intent.reason || step.title }
        };
      case "create_file":
        return {
          id: callId,
          name: "write_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || "new_file.txt",
            content: intent.expectedChange || ""
          }
        };
      case "modify_file":
        return {
          id: callId,
          name: "edit_file",
          arguments: {
            path: intent.target || step.expectedFiles?.[0] || "file.txt",
            oldText: "",
            newText: ""
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
        return undefined;
    }
  }
}
