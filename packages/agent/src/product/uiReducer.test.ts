import { describe, it, expect } from "vitest";
import { createInitialUIState, reduceUIState } from "./uiReducer.js";
import type { TaskPlan } from "../planning/types.js";

describe("Phase 5AC — Deterministic UI State Reducer", () => {
  it("initializes default UIState cleanly", () => {
    const state = createInitialUIState({
      cwd: "/test/project",
      sessionId: "session-123"
    });

    expect(state.status).toBe("idle");
    expect(state.lifecycleState).toBe("idle");
    expect(state.sessionId).toBe("session-123");
    expect(state.timeline.length).toBe(0);
  });

  it("handles run_started and state_changed transitions", () => {
    let state = createInitialUIState();

    state = reduceUIState(state, {
      type: "run_started",
      runId: "run-abc"
    });

    expect(state.status).toBe("executing");
    expect(state.lifecycleState).toBe("executing");
    expect(state.runId).toBe("run-abc");
    expect(state.timeline.length).toBe(1);

    state = reduceUIState(state, {
      type: "state_changed",
      from: "executing",
      to: "verifying",
      reason: "Running test step",
      timestamp: 1050
    });

    expect(state.status).toBe("verifying");
    expect(state.lifecycleState).toBe("verifying");
    expect(state.timeline.length).toBe(2);
  });

  it("reduces plan_created and captures pending plan approval", () => {
    let state = createInitialUIState({ runId: "run-plan" });

    const plan: TaskPlan = {
      planId: "plan-1",
      runId: "run-plan",
      objective: "Implement auth",
      userRequestSummary: "Add auth",
      status: "ready",
      risks: [],
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create auth file",
          objective: "Auth",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          status: "pending",
          verificationRequired: false
        }
      ],
      createdAt: 2000
    };

    state = reduceUIState(state, {
      type: "plan_created",
      plan
    });

    expect(state.status).toBe("awaiting_plan_approval");
    expect(state.pendingApproval).toBeDefined();
    expect(state.pendingApproval?.type).toBe("plan");
    expect(state.pendingApproval?.planId).toBe("plan-1");
    expect(state.activePlan?.totalStepsCount).toBe(1);
    expect(state.activePlan?.completedStepsCount).toBe(0);
  });

  it("handles checkpoint approval request and approval consumption", () => {
    let state = createInitialUIState({ runId: "run-cp" });

    state = reduceUIState(state, {
      type: "checkpoint_approval_requested",
      checkpointId: "cp-99",
      runId: "run-cp",
      planId: "plan-1",
      stepId: "step-1",
      stepOrder: 1,
      riskLevel: "elevated",
      reason: "Mutating core database",
      affectedTargets: ["db/schema.sql"],
      timestamp: 3000
    });

    expect(state.status).toBe("awaiting_step_approval");
    expect(state.pendingApproval?.type).toBe("step_checkpoint");
    expect(state.pendingApproval?.checkpointId).toBe("cp-99");
    expect(state.pendingApproval?.riskLevel).toBe("elevated");

    // Approved
    state = reduceUIState(state, {
      type: "execution_handoff_approved",
      runId: "run-cp",
      planId: "plan-1",
      stepId: "step-1",
      checkpointId: "cp-99",
      approvedBy: "user",
      timestamp: 3050
    });

    expect(state.status).toBe("executing");
    expect(state.pendingApproval).toBeUndefined();
  });

  it("handles recovery and continuation lifecycle", () => {
    let state = createInitialUIState({ runId: "run-rec" });

    state = reduceUIState(state, {
      type: "recovery_started",
      recoveryId: "rec-1",
      runId: "run-rec",
      planId: "plan-1",
      strategy: "rollback",
      timestamp: 4000
    });

    expect(state.status).toBe("recovering");
    expect(state.activeRecovery?.strategy).toBe("rollback");

    state = reduceUIState(state, {
      type: "recovery_outcome_determined",
      recoveryId: "rec-1",
      runId: "run-rec",
      planId: "plan-1",
      outcome: "recovered",
      result: {
        recoveryId: "rec-1",
        runId: "run-rec",
        planId: "plan-1",
        strategy: "rollback",
        status: "recovered",
        outcome: "recovered",
        startedAt: 4000,
        completedAt: 4050,
        durationMs: 50,
        affectedSteps: [],
        repairedFiles: [],
        completedRecoveryActions: [],
        failedRecoveryActions: [],
        blockingReasons: [],
        workspaceConsistent: true,
        finalPlanStatus: "ready",
        recoveryDepth: 1
      },
      timestamp: 4050
    });

    expect(state.status).toBe("awaiting_continuation");

    state = reduceUIState(state, {
      type: "recovery_continuation_started",
      continuationId: "cont-1",
      runId: "run-rec",
      planId: "plan-1",
      resumedStepIds: ["step-1"],
      timestamp: 4100
    });

    expect(state.status).toBe("executing");

    state = reduceUIState(state, {
      type: "recovery_continuation_completed",
      continuationId: "cont-1",
      runId: "run-rec",
      planId: "plan-1",
      result: {
        continuationId: "cont-1",
        runId: "run-rec",
        planId: "plan-1",
        decision: "continue",
        recoveryOutcome: "recovered",
        status: "completed",
        startingPlanStatus: "ready",
        finalPlanStatus: "completed",
        resumedStepIds: ["step-1"],
        completedStepIds: ["step-1"],
        skippedStepIds: [],
        startedAt: 4100,
        completedAt: 4150,
        durationMs: 50
      },
      timestamp: 4150
    });

    expect(state.activeRecovery).toBeUndefined();
  });

  it("enforces terminal state locking: late non-terminal events cannot overwrite terminal state", () => {
    let state = createInitialUIState({ runId: "run-term" });

    state = reduceUIState(state, {
      type: "plan_execution_completed",
      runId: "run-term",
      planId: "plan-1",
      completedSteps: 3,
      totalSteps: 3,
      durationMs: 1500
    });

    expect(state.status).toBe("completed");
    expect(state.lifecycleState).toBe("completed");

    // Late text event
    state = reduceUIState(state, {
      type: "text",
      content: "Late log message"
    });

    expect(state.status).toBe("completed");
    expect(state.lifecycleState).toBe("completed");
    expect(state.messages.length).toBe(1);

    // Stray state_changed event
    state = reduceUIState(state, {
      type: "state_changed",
      from: "completed",
      to: "executing",
      reason: "Stray transition"
    });

    expect(state.status).toBe("completed");
    expect(state.lifecycleState).toBe("completed");
  });
});
