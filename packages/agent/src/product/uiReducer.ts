import type { AgentEvent } from "../index.js";
import type { TaskPlan, PlanStep } from "../planning/types.js";
import type {
  UIState,
  UIStatus,
  PlanSnapshot,
  StepSnapshot,
  UIApprovalModel
} from "./types.js";

const TERMINAL_UI_STATUSES: Set<UIStatus> = new Set([
  "completed",
  "failed",
  "cancelled"
]);

export function createInitialUIState(options?: Partial<UIState>): UIState {
  return {
    status: options?.status || "idle",
    lifecycleState: options?.lifecycleState || "idle",
    sessionId:
      options?.sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    cwd: options?.cwd || process.cwd(),
    timeline: options?.timeline ? [...options.timeline] : [],
    messages: options?.messages ? [...options.messages] : [],
    skills: options?.skills ? [...options.skills] : [],
    riskLevel: options?.riskLevel || "low",
    runId: options?.runId,
    userRequest: options?.userRequest,
    activePlan: options?.activePlan,
    activeStepId: options?.activeStepId,
    activeTool: options?.activeTool,
    activeVerification: options?.activeVerification,
    activeRecovery: options?.activeRecovery,
    pendingApproval: options?.pendingApproval,
    error: options?.error,
    workspace: options?.workspace,
    diagnostics: options?.diagnostics
  };
}

function convertStepToSnapshot(step: PlanStep): StepSnapshot {
  return {
    stepId: step.stepId,
    order: step.order,
    title: step.title,
    objective: step.objective,
    type: step.type,
    dependencies: [...step.dependencies],
    riskLevel: step.riskLevel,
    status: step.status,
    verificationRequired: step.verificationRequired,
    expectedFiles: step.expectedFiles ? [...step.expectedFiles] : undefined
  };
}

function convertPlanToSnapshot(plan: TaskPlan): PlanSnapshot {
  const steps = plan.steps.map(convertStepToSnapshot);
  const completedCount = steps.filter((s) => s.status === "completed").length;
  return {
    planId: plan.planId,
    runId: plan.runId,
    objective: plan.objective,
    userRequestSummary: plan.userRequestSummary,
    status: plan.status,
    steps,
    createdAt: plan.createdAt,
    completedStepsCount: completedCount,
    totalStepsCount: steps.length
  };
}

export function reduceUIState(state: UIState, event: AgentEvent): UIState {
  const next: UIState = {
    ...state,
    timeline: [...state.timeline],
    messages: [...state.messages],
    skills: [...state.skills]
  };

  const isTerminal = TERMINAL_UI_STATUSES.has(state.status);
  const now = Date.now();

  switch (event.type) {
    case "run_started": {
      if (!isTerminal) {
        next.runId = event.runId;
        next.status = "executing";
        next.lifecycleState = "executing";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "run_event",
        timestamp: now,
        title: "Run started",
        description: `Run ${event.runId} initiated`,
        status: "running"
      });
      break;
    }

    case "state_changed": {
      if (!isTerminal) {
        next.lifecycleState = event.to;
        if (event.to === "idle") {
          next.status = "idle";
        } else if (event.to === "planning") {
          next.status = "planning";
        } else if (event.to === "executing") {
          next.status = next.pendingApproval ? "awaiting_step_approval" : "executing";
        } else if (event.to === "verifying" || event.to === "reconciling") {
          next.status = "verifying";
        } else if (event.to === "recovering") {
          next.status = "recovering";
        } else if (event.to === "completed") {
          next.status = "completed";
        } else if (event.to === "failed") {
          next.status = "failed";
        } else if (event.to === "cancelled") {
          next.status = "cancelled";
        }
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "run_event",
        timestamp: event.timestamp || now,
        title: `State transition: ${event.from} -> ${event.to}`,
        description: event.reason,
        status: event.to === "completed" ? "completed" : event.to === "failed" ? "failed" : "running"
      });
      break;
    }

    case "text": {
      next.messages.push({
        id: `msg-${now}-${Math.random().toString(36).substring(2, 6)}`,
        sender: "assistant",
        text: event.content,
        timestamp: now
      });
      break;
    }

    case "skills_activated": {
      next.skills = [...event.skills];
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "run_event",
        timestamp: now,
        title: "Skills activated",
        description: event.skills.join(", "),
        status: "completed"
      });
      break;
    }

    case "plan_created": {
      next.activePlan = convertPlanToSnapshot(event.plan);
      if (!isTerminal) {
        if (event.plan.status === "draft" || event.plan.status === "ready") {
          next.status = "awaiting_plan_approval";
          next.pendingApproval = {
            approvalId: `plan-app-${event.plan.planId}`,
            type: "plan",
            runId: event.plan.runId,
            planId: event.plan.planId,
            riskLevel: "normal",
            reason: `Approval required for task plan: ${event.plan.userRequestSummary}`,
            affectedTargets: [],
            defaultDecision: "reject"
          };
        } else {
          next.status = "planning";
        }
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.plan.createdAt || now,
        title: "Task plan created",
        description: `${event.plan.steps.length} step(s): ${event.plan.objective}`,
        status: "completed"
      });
      break;
    }

    case "plan_execution_started": {
      if (!isTerminal) {
        next.status = "executing";
        next.lifecycleState = "executing";
        next.pendingApproval = undefined;
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan execution started",
        description: `Plan ${event.planId} (${event.totalSteps} steps)`,
        status: "running"
      });
      break;
    }

    case "plan_step_started": {
      next.activeStepId = event.stepId;
      if (!isTerminal) {
        next.status = "executing";
      }
      if (next.activePlan) {
        next.activePlan = {
          ...next.activePlan,
          steps: next.activePlan.steps.map((s) =>
            s.stepId === event.stepId ? { ...s, status: "in_progress" as const } : s
          )
        };
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: `Step ${event.stepIndex + 1} started`,
        description: event.title || event.stepId,
        status: "running",
        metadata: { stepId: event.stepId, planId: event.planId }
      });
      break;
    }

    case "plan_step_waiting_approval":
    case "approval_required": {
      if (!isTerminal) {
        next.status = "awaiting_step_approval";
      }
      const req = event.request;
      const stepId = "stepId" in event ? event.stepId : undefined;
      const planId = "planId" in event ? event.planId : undefined;
      const runId = "runId" in event ? event.runId : next.runId || "unknown";

      const rawArgs = req.arguments as Record<string, unknown> | undefined;
      const affectedTargets: string[] = Array.isArray(rawArgs?.targetFiles)
        ? (rawArgs.targetFiles as string[])
        : rawArgs?.path
          ? [String(rawArgs.path)]
          : [];

      const approval: UIApprovalModel = {
        approvalId: req.id,
        type: "tool_permission",
        runId: runId || "unknown",
        planId: planId || next.activePlan?.planId,
        stepId: stepId || next.activeStepId,
        toolName: req.toolName,
        riskLevel: "normal",
        reason: req.reason || `Approval required for tool ${req.toolName}`,
        affectedTargets,
        defaultDecision: "reject"
      };

      const eventTime = "timestamp" in event && typeof event.timestamp === "number" ? event.timestamp : now;
      next.pendingApproval = approval;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "approval",
        timestamp: eventTime,
        title: `Approval required for ${req.toolName}`,
        description: req.reason,
        status: "pending",
        metadata: { approvalId: req.id, stepId }
      });
      break;
    }

    case "checkpoint_approval_requested": {
      if (!isTerminal) {
        next.status = "awaiting_step_approval";
      }
      next.pendingApproval = {
        approvalId: event.checkpointId,
        type: "step_checkpoint",
        runId: event.runId,
        planId: event.planId,
        stepId: event.stepId,
        riskLevel: event.riskLevel,
        reason: event.reason,
        affectedTargets: [...event.affectedTargets],
        checkpointId: event.checkpointId,
        expiresAt: event.expiresAt,
        defaultDecision: "reject"
      };
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "approval",
        timestamp: event.timestamp || now,
        title: `Checkpoint approval required for step ${event.stepId}`,
        description: event.reason,
        status: "pending",
        metadata: { checkpointId: event.checkpointId, riskLevel: event.riskLevel }
      });
      break;
    }

    case "checkpoint_approved":
    case "execution_handoff_approved": {
      next.pendingApproval = undefined;
      if (!isTerminal) {
        next.status = "executing";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "approval",
        timestamp: event.timestamp || now,
        title: `Approval granted by ${event.approvedBy}`,
        description: `Approved for step ${event.stepId}`,
        status: "approved"
      });
      break;
    }

    case "checkpoint_rejected":
    case "execution_handoff_rejected": {
      next.pendingApproval = undefined;
      if (!isTerminal) {
        next.status = "blocked";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "approval",
        timestamp: event.timestamp || now,
        title: `Approval rejected`,
        description: event.reason || "Rejected by user",
        status: "rejected"
      });
      break;
    }

    case "checkpoint_invalidated":
    case "execution_handoff_invalidated": {
      next.pendingApproval = undefined;
      if (!isTerminal) {
        next.status = "blocked";
        next.error = event.reason;
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "approval",
        timestamp: event.timestamp || now,
        title: "Checkpoint invalidated",
        description: event.reason,
        status: "failed"
      });
      break;
    }

    case "execution_handoff_blocked": {
      if (!isTerminal) {
        next.status = "blocked";
        next.error = event.blockers?.join("; ");
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "run_event",
        timestamp: event.timestamp || now,
        title: "Execution handoff blocked",
        description: event.blockers?.join("; "),
        status: "failed"
      });
      break;
    }

    case "plan_step_completed": {
      if (next.activePlan) {
        const steps = next.activePlan.steps.map((s) =>
          s.stepId === event.stepId ? { ...s, status: "completed" as const, durationMs: event.durationMs } : s
        );
        const completedCount = steps.filter((s) => s.status === "completed").length;
        next.activePlan = {
          ...next.activePlan,
          steps,
          completedStepsCount: completedCount
        };
      }
      next.activeTool = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: `Step ${event.stepIndex + 1} completed`,
        description: `Duration: ${event.durationMs || 0}ms`,
        status: "completed",
        metadata: { stepId: event.stepId }
      });
      break;
    }

    case "plan_step_failed": {
      if (next.activePlan) {
        const steps = next.activePlan.steps.map((s) =>
          s.stepId === event.stepId
            ? { ...s, status: "failed" as const, error: event.error, durationMs: event.durationMs }
            : s
        );
        next.activePlan = {
          ...next.activePlan,
          steps
        };
      }
      if (!isTerminal) {
        next.error = event.error;
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: `Step ${event.stepIndex + 1} failed`,
        description: event.error || "Execution error",
        status: "failed",
        metadata: { stepId: event.stepId }
      });
      break;
    }

    case "plan_step_skipped": {
      if (next.activePlan) {
        const steps = next.activePlan.steps.map((s) =>
          s.stepId === event.stepId ? { ...s, status: "skipped" as const } : s
        );
        next.activePlan = {
          ...next.activePlan,
          steps
        };
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: `Step ${event.stepIndex + 1} skipped`,
        description: event.reason,
        status: "skipped",
        metadata: { stepId: event.stepId }
      });
      break;
    }

    case "tool_started": {
      next.activeTool = {
        callId: event.callId,
        toolName: event.toolName,
        startedAt: now
      };
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "tool_call",
        timestamp: now,
        title: `Tool invocation: ${event.toolName}`,
        status: "running",
        metadata: { toolName: event.toolName, callId: event.callId }
      });
      break;
    }

    case "tool_completed":
    case "tool_result": {
      next.activeTool = undefined;
      break;
    }

    case "verification_started": {
      if (!isTerminal) {
        next.status = "verifying";
      }
      next.activeVerification = {
        stepId: "",
        command: event.command,
        startedAt: now
      };
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "verification",
        timestamp: now,
        title: `Verification running: ${event.command}`,
        status: "running",
        metadata: { command: event.command }
      });
      break;
    }

    case "verification_completed": {
      next.activeVerification = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "verification",
        timestamp: now,
        title: `Verification ${event.success ? "succeeded" : "failed"} (attempt ${event.attempt})`,
        status: event.success ? "completed" : "failed"
      });
      break;
    }

    case "recovery_started": {
      if (!isTerminal) {
        next.status = "recovering";
      }
      const recId = "recoveryId" in event ? event.recoveryId : "rec";
      const strat = "strategy" in event ? event.strategy : "checkpoint";
      const recTime = "timestamp" in event && typeof event.timestamp === "number" ? event.timestamp : now;
      next.activeRecovery = {
        recoveryId: recId,
        strategy: strat,
        startedAt: recTime
      };
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "recovery",
        timestamp: recTime,
        title: `Recovery started: ${strat}`,
        status: "running"
      });
      break;
    }

    case "recovery_outcome_determined": {
      if (!isTerminal) {
        next.status = event.outcome === "recovered" ? "awaiting_continuation" : "blocked";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "recovery",
        timestamp: event.timestamp || now,
        title: `Recovery outcome: ${event.outcome}`,
        status: event.outcome === "recovered" ? "completed" : "failed"
      });
      break;
    }

    case "recovery_continuation_started": {
      if (!isTerminal) {
        next.status = "executing";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "recovery",
        timestamp: event.timestamp || now,
        title: "Recovery continuation started",
        status: "running"
      });
      break;
    }

    case "recovery_continuation_completed": {
      next.activeRecovery = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "recovery",
        timestamp: event.timestamp || now,
        title: "Recovery continuation completed",
        status: "completed"
      });
      break;
    }

    case "step_retry_started": {
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "retry",
        timestamp: event.timestamp || now,
        title: `Step retry attempt ${event.attempt}/${event.maxAttempts}`,
        description: event.reason,
        status: "running",
        metadata: { stepId: event.stepId, attempt: event.attempt }
      });
      break;
    }

    case "plan_adaptation_required": {
      if (!isTerminal) {
        next.status = "awaiting_replan";
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan adaptation / replanning required",
        description: event.reason,
        status: "pending"
      });
      break;
    }

    case "plan_blocked": {
      if (!isTerminal) {
        next.status = "blocked";
        next.error = event.reason;
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan blocked",
        description: event.reason,
        status: "failed"
      });
      break;
    }

    case "plan_execution_completed": {
      next.status = "completed";
      next.lifecycleState = "completed";
      if (next.activePlan) {
        next.activePlan = { ...next.activePlan, status: "completed" };
      }
      next.activeStepId = undefined;
      next.activeTool = undefined;
      next.activeVerification = undefined;
      next.pendingApproval = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan execution completed",
        description: `Completed ${event.completedSteps}/${event.totalSteps} steps in ${event.durationMs || 0}ms`,
        status: "completed"
      });
      break;
    }

    case "plan_execution_failed": {
      next.status = "failed";
      next.lifecycleState = "failed";
      next.error = event.reason || "Plan execution failed";
      if (next.activePlan) {
        next.activePlan = { ...next.activePlan, status: "failed" };
      }
      next.activeStepId = undefined;
      next.activeTool = undefined;
      next.activeVerification = undefined;
      next.pendingApproval = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan execution failed",
        description: event.reason || "Plan failed",
        status: "failed"
      });
      break;
    }

    case "plan_execution_cancelled": {
      next.status = "cancelled";
      next.lifecycleState = "cancelled";
      if (next.activePlan) {
        next.activePlan = { ...next.activePlan, status: "cancelled" };
      }
      next.activeStepId = undefined;
      next.activeTool = undefined;
      next.activeVerification = undefined;
      next.pendingApproval = undefined;
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "plan_step",
        timestamp: event.timestamp || now,
        title: "Plan execution cancelled",
        status: "cancelled"
      });
      break;
    }

    case "done": {
      if (!isTerminal) {
        if (next.status === "executing" || next.status === "verifying") {
          next.status = "completed";
          next.lifecycleState = "completed";
        }
      }
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "run_event",
        timestamp: now,
        title: "Task completed",
        status: "completed"
      });
      break;
    }

    case "error": {
      next.status = "failed";
      next.lifecycleState = "failed";
      next.error = event.error instanceof Error ? event.error.message : String(event.error);
      next.timeline.push({
        id: `tl-${now}-${Math.random().toString(36).substring(2, 6)}`,
        type: "error",
        timestamp: now,
        title: "Error occurred",
        description: next.error,
        status: "failed"
      });
      break;
    }

    default:
      break;
  }

  return next;
}
