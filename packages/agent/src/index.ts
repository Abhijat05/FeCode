import type {
  ApprovalRequest,
  ModelProvider,
  ToolCall,
  ToolResult
} from "@fecode/models";
import type { ID } from "@fecode/shared";

import type { TaskPlan } from "./planning/types.js";
import type { TaskCompletionSummary } from "./completion/types.js";
import type { PersistedSessionData } from "./session/types.js";

export interface Agent {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  clear?(): void;
  getCompletionSummary?(): TaskCompletionSummary;
  restoreSession?(data: PersistedSessionData): void;
}

export interface AgentInput {
  message: string;
  cwd: string;
  sessionId?: string;
  provider?: ModelProvider;
  id?: ID;
  parentRunId?: string;
  resumeDepth?: number;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "approval_required"; request: ApprovalRequest }
  | { type: "tool_result"; result: ToolResult; callId: string }
  | { type: "done" }
  | { type: "error"; error: Error }
  | { type: "skills_activated"; skills: string[] }
  | { type: "plan_created"; plan: TaskPlan }
  | {
      type: "plan_execution_started";
      runId?: string;
      planId: string;
      totalSteps: number;
      timestamp?: number;
    }
  | {
      type: "plan_step_started";
      runId?: string;
      planId: string;
      stepId: string;
      stepIndex: number;
      title?: string;
      timestamp?: number;
    }
  | {
      type: "plan_step_waiting_approval";
      runId?: string;
      planId: string;
      stepId: string;
      request: ApprovalRequest;
      timestamp?: number;
    }
  | {
      type: "plan_step_completed";
      runId?: string;
      planId: string;
      stepId: string;
      stepIndex: number;
      durationMs?: number;
      timestamp?: number;
    }
  | {
      type: "plan_step_failed";
      runId?: string;
      planId: string;
      stepId: string;
      stepIndex: number;
      error?: string;
      durationMs?: number;
      timestamp?: number;
    }
  | {
      type: "plan_step_skipped";
      runId?: string;
      planId: string;
      stepId: string;
      stepIndex: number;
      reason: string;
      timestamp?: number;
    }
  | {
      type: "plan_execution_completed";
      runId?: string;
      planId: string;
      completedSteps: number;
      totalSteps: number;
      durationMs?: number;
      timestamp?: number;
    }
  | {
      type: "plan_execution_failed";
      runId?: string;
      planId: string;
      failedStep?: string;
      reason?: string;
      timestamp?: number;
    }
  | {
      type: "plan_execution_cancelled";
      runId?: string;
      planId: string;
      reason?: string;
      timestamp?: number;
    }
  | {
      type: "replan_requested";
      runId: string;
      previousPlanId: string;
      reason: string;
      timestamp?: number;
    }
  | {
      type: "replan_assessment_completed";
      runId: string;
      previousPlanId: string;
      eligible: boolean;
      reason: string;
      timestamp?: number;
    }
  | {
      type: "replan_approved";
      runId: string;
      previousPlanId: string;
      timestamp?: number;
    }
  | {
      type: "replan_rejected";
      runId: string;
      previousPlanId: string;
      reason?: string;
      timestamp?: number;
    }
  | {
      type: "replan_created";
      runId: string;
      previousPlanId: string;
      newPlanId: string;
      replanDepth: number;
      timestamp?: number;
    }
  | {
      type: "replan_failed";
      runId: string;
      previousPlanId: string;
      reason: string;
      timestamp?: number;
    }
  | {
      type: "execution_feedback_detected";
      runId: string;
      planId: string;
      stepId?: string;
      feedbackId: string;
      kind: import("./planning/types.js").ExecutionFeedbackKind;
      severity: import("./planning/types.js").ExecutionFeedbackSeverity;
      summary: string;
      recommendedAction: import("./planning/types.js").ExecutionFeedbackAction;
      timestamp?: number;
    }
  | {
      type: "step_retry_started";
      runId: string;
      planId: string;
      stepId: string;
      attempt: number;
      maxAttempts: number;
      reason: string;
      timestamp?: number;
    }
  | {
      type: "step_retry_completed";
      runId: string;
      planId: string;
      stepId: string;
      attempt: number;
      success: boolean;
      error?: string;
      timestamp?: number;
    }
  | {
      type: "plan_blocked";
      runId: string;
      planId: string;
      blockedStepId?: string;
      reason: string;
      affectedSteps: string[];
      recommendedAction: import("./planning/types.js").ExecutionFeedbackAction;
      timestamp?: number;
    }
  | {
      type: "plan_adaptation_required";
      runId: string;
      planId: string;
      reason: string;
      affectedSteps: string[];
      timestamp?: number;
    }
  | {
      type: "execution_decision_requested";
      request: import("./planning/types.js").ExecutionDecisionRequest;
      timestamp: number;
    }
  | {
      type: "execution_decision_resolved";
      result: import("./planning/types.js").ExecutionDecisionResult;
      timestamp: number;
    }
  | {
      type: "execution_resume_started";
      runId: string;
      planId: string;
      stepId: string;
      stepOrder: number;
      timestamp: number;
    }
  | {
      type: "execution_resume_completed";
      runId: string;
      planId: string;
      completedSteps: number;
      totalSteps: number;
      timestamp: number;
    }
  | {
      type: "execution_resume_failed";
      runId: string;
      planId: string;
      stepId?: string;
      reason: string;
      timestamp: number;
    }
  | {
      type: "execution_cancelled";
      runId: string;
      planId?: string;
      reason: string;
      timestamp: number;
    }
  | {
      type: "final_reconciliation_started";
      runId: string;
      planId: string;
      timestamp: number;
    }
  | {
      type: "final_reconciliation_completed";
      result: import("./planning/types.js").FinalReconciliationResult;
      timestamp: number;
    }
  | {
      type: "final_reconciliation_failed";
      result: import("./planning/types.js").FinalReconciliationResult;
      timestamp: number;
    }
  | {
      type: "recovery_assessment_started";
      runId: string;
      planId: string;
      timestamp: number;
    }
  | {
      type: "recovery_assessment_completed";
      assessment: import("./planning/types.js").ExecutionRecoveryAssessment;
      timestamp: number;
    }
  | {
      type: "recovery_waiting_approval";
      request: import("./planning/types.js").ExecutionRecoveryRequest;
      assessment: import("./planning/types.js").ExecutionRecoveryAssessment;
      timestamp: number;
    }
  | {
      type: "recovery_started";
      recoveryId: string;
      runId: string;
      planId: string;
      strategy: import("./planning/types.js").RecoveryStrategy;
      timestamp: number;
    }
  | {
      type: "recovery_step_started";
      recoveryId: string;
      stepIndex: number;
      totalSteps: number;
      title: string;
      timestamp: number;
    }
  | {
      type: "recovery_step_completed";
      recoveryId: string;
      stepIndex: number;
      totalSteps: number;
      title: string;
      success: boolean;
      timestamp: number;
    }
  | {
      type: "recovery_verification_started";
      recoveryId: string;
      command: string;
      timestamp: number;
    }
  | {
      type: "recovery_verification_completed";
      recoveryId: string;
      command: string;
      success: boolean;
      timestamp: number;
    }
  | {
      type: "recovery_reconciliation_started";
      recoveryId: string;
      timestamp: number;
    }
  | {
      type: "recovery_reconciliation_completed";
      recoveryId: string;
      result: import("./planning/types.js").FinalReconciliationResult;
      timestamp: number;
    }
  | {
      type: "recovery_outcome_determined";
      recoveryId: string;
      runId: string;
      planId: string;
      outcome: import("./planning/types.js").RecoveryOutcomeStatus;
      result: import("./planning/types.js").ExecutionRecoveryResult;
      timestamp: number;
    }
  | {
      type: "recovery_continuation_started";
      recoveryId: string;
      planId: string;
      nextStepId: string;
      timestamp: number;
    }
  | {
      type: "recovery_continuation_completed";
      recoveryId: string;
      planId: string;
      timestamp: number;
    }
  | {
      type: "recovery_still_blocked";
      recoveryId: string;
      planId: string;
      result: import("./planning/types.js").ExecutionRecoveryResult;
      blockingReasons: string[];
      timestamp: number;
    }
  | {
      type: "recovery_completed";
      result: import("./planning/types.js").ExecutionRecoveryResult;
      timestamp: number;
    }
  | {
      type: "recovery_blocked";
      result: import("./planning/types.js").ExecutionRecoveryResult;
      reason: string;
      timestamp: number;
    }
  | {
      type: "recovery_failed";
      result: import("./planning/types.js").ExecutionRecoveryResult;
      reason: string;
      timestamp: number;
    }
  | {
      type: "recovery_cancelled";
      recoveryId: string;
      runId: string;
      planId: string;
      reason: string;
      timestamp: number;
    }
  | { type: "task_summary"; summary: TaskCompletionSummary }
  | { type: "run_started"; runId: string }
  | {
      type: "state_changed";
      runId?: string;
      from: import("./run/types.js").AgentRunStatus;
      to: import("./run/types.js").AgentRunStatus;
      reason: string;
      timestamp?: number;
    }
  | { type: "tool_started"; runId?: string; toolName: string; callId: string }
  | { type: "tool_completed"; runId?: string; toolName: string; callId: string; success: boolean }
  | { type: "verification_started"; runId?: string; command: string; attempt: number }
  | { type: "verification_completed"; runId?: string; command: string; success: boolean; attempt: number }
  | { type: "recovery_started"; runId?: string; checkpointId: string }
  | { type: "recovery_completed"; runId?: string; checkpointId: string; success: boolean }
  | { type: "run_completed"; runId: string }
  | { type: "run_failed"; runId: string; code?: string; error?: string }
  | { type: "run_cancelled"; runId: string };

export * from "./runtime.js";
export * from "./systemPrompt.js";
export * from "./tools/mockEchoTool.js";
export * from "./tools/mockWriteTool.js";
export * from "./tools/pathUtils.js";
export * from "./tools/diffUtils.js";
export * from "./tools/ignoreUtils.js";
export * from "./tools/listDirectory.js";
export * from "./tools/readFile.js";
export * from "./tools/searchFiles.js";
export * from "./tools/writeFile.js";
export * from "./tools/editFile.js";
export * from "./tools/defaultRegistry.js";
export * from "./commands/types.js";
export * from "./commands/policy.js";
export * from "./commands/nodeExecutor.js";
export * from "./commands/mockExecutor.js";
export * from "./commands/executeCommandTool.js";
export * from "./project/index.js";
export * from "./skills/types.js";
export * from "./skills/registry.js";
export * from "./skills/builtins/index.js";
export * from "./skills/recommender.js";
export * from "./skills/selector.js";
export * from "./skills/composer.js";
export * from "./skills/parser.js";
export * from "./skills/loader.js";
export * from "./skills/requestRecommender.js";
export * from "./skills/activation.js";
export * from "./optimization/index.js";
export * from "./policies/index.js";
export type {
  TaskStatus as LegacyTaskStatus,
  TaskStep as LegacyTaskStep,
  TaskPlan as LegacyTaskPlan
} from "./tasks/types.js";
export {
  startTaskStep,
  completeTaskStep as completeLegacyTaskStep,
  failTaskStep
} from "./tasks/taskPlan.js";
export * from "./exploration/index.js";
export * from "./context/index.js";
export * from "./editing/index.js";
export type {
  ExecutionIntent as StrategyExecutionIntent,
  ExecutionPhase,
  AgentExecutionDecision,
  DecisionContext,
  AgentExecutionStrategy
} from "./strategy/types.js";
export { DefaultAgentExecutionStrategy } from "./strategy/executionStrategy.js";
export * from "./completion/index.js";
export * from "./session/index.js";
export * from "./changes/index.js";
export * from "./git/index.js";
export * from "./checkpoints/index.js";
export * from "./recovery/index.js";
export * from "./policy/index.js";
export * from "./run/index.js";
export * from "./diagnostics/index.js";
export * from "./history/index.js";
export * from "./planning/index.js";
