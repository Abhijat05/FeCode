import { describe, it, expect } from "vitest";
import { DefaultAgentRunStateMachine } from "./stateMachine.js";

describe("AgentRunStateMachine — Phase 5K", () => {
  it("executes standard successful lifecycle (idle -> planning -> executing -> verifying -> completed)", () => {
    const sm = new DefaultAgentRunStateMachine();
    expect(sm.getState()).toBe("idle");
    expect(sm.isTerminal()).toBe(false);

    let res = sm.transition("planning", "Task initialized");
    expect(res.success).toBe(true);
    expect(sm.getState()).toBe("planning");

    res = sm.transition("executing", "Tool execution started");
    expect(res.success).toBe(true);
    expect(sm.getState()).toBe("executing");

    res = sm.transition("verifying", "Running verification checks");
    expect(res.success).toBe(true);
    expect(sm.getState()).toBe("verifying");

    res = sm.transition("completed", "Verification passed and task finished");
    expect(res.success).toBe(true);
    expect(sm.getState()).toBe("completed");
    expect(sm.isTerminal()).toBe(true);

    const history = sm.getTransitions();
    expect(history.length).toBe(4);
    expect(history.map((t) => `${t.from}->${t.to}`)).toEqual([
      "idle->planning",
      "planning->executing",
      "executing->verifying",
      "verifying->completed"
    ]);
  });

  it("executes failure lifecycle (idle -> planning -> executing -> verifying -> failed)", () => {
    const sm = new DefaultAgentRunStateMachine();

    sm.transition("planning", "Task initialized");
    sm.transition("executing", "Tool execution started");
    sm.transition("verifying", "Running verification checks");
    const failRes = sm.transition(
      "failed",
      "Verification attempts exhausted"
    );

    expect(failRes.success).toBe(true);
    expect(sm.getState()).toBe("failed");
    expect(sm.isTerminal()).toBe(true);
  });

  it("executes recovery lifecycle (idle -> planning -> executing -> verifying -> recovering -> verifying -> completed)", () => {
    const sm = new DefaultAgentRunStateMachine();

    sm.transition("planning", "Task initialized");
    sm.transition("executing", "Tool execution started");
    sm.transition("verifying", "Running verification checks");

    // Verification failed, recovery approved
    const recRes = sm.transition(
      "recovering",
      "User approved checkpoint recovery"
    );
    expect(recRes.success).toBe(true);
    expect(sm.getState()).toBe("recovering");

    // Post-recovery verification
    const postVerifyRes = sm.transition(
      "verifying",
      "Verifying restored repository state"
    );
    expect(postVerifyRes.success).toBe(true);
    expect(sm.getState()).toBe("verifying");

    // Completed
    const compRes = sm.transition("completed", "Restored state verified clean");
    expect(compRes.success).toBe(true);
    expect(sm.getState()).toBe("completed");
    expect(sm.isTerminal()).toBe(true);
  });

  it("supports safe cancellation from any active state", () => {
    // Cancellation from planning
    const sm1 = new DefaultAgentRunStateMachine();
    sm1.transition("planning", "Task initialized");
    const cancel1 = sm1.transition("cancelled", "User cancelled during planning");
    expect(cancel1.success).toBe(true);
    expect(sm1.getState()).toBe("cancelled");
    expect(sm1.isTerminal()).toBe(true);

    // Cancellation from executing
    const sm2 = new DefaultAgentRunStateMachine();
    sm2.transition("planning", "Task initialized");
    sm2.transition("executing", "Tool execution started");
    const cancel2 = sm2.transition("cancelled", "User cancelled via Ctrl+C");
    expect(cancel2.success).toBe(true);
    expect(sm2.getState()).toBe("cancelled");

    // Cancellation from verifying
    const sm3 = new DefaultAgentRunStateMachine();
    sm3.transition("planning", "Task initialized");
    sm3.transition("executing", "Tool execution started");
    sm3.transition("verifying", "Running verification");
    const cancel3 = sm3.transition("cancelled", "User cancelled during verify");
    expect(cancel3.success).toBe(true);
    expect(sm3.getState()).toBe("cancelled");

    // Cancellation from recovering
    const sm4 = new DefaultAgentRunStateMachine();
    sm4.transition("planning", "Task initialized");
    sm4.transition("executing", "Tool execution started");
    sm4.transition("recovering", "Restoring checkpoint");
    const cancel4 = sm4.transition("cancelled", "User cancelled during restore");
    expect(cancel4.success).toBe(true);
    expect(sm4.getState()).toBe("cancelled");
  });

  it("rejects illegal state transitions without throwing errors", () => {
    const sm = new DefaultAgentRunStateMachine();
    sm.transition("planning", "Task initialized");
    sm.transition("executing", "Tool execution started");
    sm.transition("completed", "Task finished");

    // Illegal transition from completed
    const illegal1 = sm.transition("executing", "Try to execute after completion");
    expect(illegal1.success).toBe(false);
    expect(illegal1.error).toContain("INVALID_STATE_TRANSITION");
    expect(sm.getState()).toBe("completed");

    const illegal2 = sm.transition("planning", "Try to plan after completion");
    expect(illegal2.success).toBe(false);
    expect(illegal2.error).toContain("INVALID_STATE_TRANSITION");
  });

  it("rejects transitions from terminal states (failed and cancelled)", () => {
    const smFailed = new DefaultAgentRunStateMachine();
    smFailed.transition("planning", "Task initialized");
    smFailed.transition("failed", "Fatal error");

    const illegalFromFailed = smFailed.transition("executing", "Resume");
    expect(illegalFromFailed.success).toBe(false);
    expect(smFailed.getState()).toBe("failed");

    const smCancelled = new DefaultAgentRunStateMachine();
    smCancelled.transition("cancelled", "User aborted");

    const illegalFromCancelled = smCancelled.transition("verifying", "Verify");
    expect(illegalFromCancelled.success).toBe(false);
    expect(smCancelled.getState()).toBe("cancelled");
  });

  it("generates unique run IDs and preserves context metadata without secrets", () => {
    const sm1 = new DefaultAgentRunStateMachine();
    const sm2 = new DefaultAgentRunStateMachine();

    expect(sm1.getContext().runId).toBeDefined();
    expect(sm2.getContext().runId).toBeDefined();
    expect(sm1.getContext().runId).not.toBe(sm2.getContext().runId);
    expect(sm1.getContext().runId.startsWith("run-")).toBe(true);

    sm1.setActiveCheckpointId("checkpoint-123");
    sm1.setActiveSkills(["git-workflow", "react-expert"]);
    const ctx = sm1.getContext();
    expect(ctx.activeCheckpointId).toBe("checkpoint-123");
    expect(ctx.activeSkillNames).toEqual(["git-workflow", "react-expert"]);
  });

  it("tracks bounded verification and recovery attempts", () => {
    const sm = new DefaultAgentRunStateMachine({
      maxVerificationAttempts: 3,
      maxRecoveryAttempts: 1
    });

    expect(sm.incrementVerificationAttempts()).toBe(1);
    expect(sm.incrementVerificationAttempts()).toBe(2);
    expect(sm.incrementVerificationAttempts()).toBe(3);
    expect(sm.getContext().verificationAttempts).toBe(3);

    expect(sm.incrementRecoveryAttempts()).toBe(1);
    expect(sm.getContext().recoveryAttempts).toBe(1);
  });

  it("preserves state context integrity across multiple transitions", () => {
    const cwd = "/workspace/project";
    const sm = new DefaultAgentRunStateMachine({
      cwd,
      maxVerificationAttempts: 3,
      maxRecoveryAttempts: 2
    });

    const initialCtx = sm.getContext();
    const runId = initialCtx.runId;
    const startedAt = initialCtx.startedAt;

    sm.setActiveCheckpointId("cp-safeguard-1");
    sm.setActiveSkills(["typescript", "refactoring"]);

    sm.transition("planning", "Planning phase");
    sm.transition("executing", "Tool phase");
    sm.transition("verifying", "Verification phase");

    const midCtx = sm.getContext();
    expect(midCtx.runId).toBe(runId);
    expect(midCtx.startedAt).toBe(startedAt);
    expect(midCtx.cwd).toBe(cwd);
    expect(midCtx.activeCheckpointId).toBe("cp-safeguard-1");
    expect(midCtx.activeSkillNames).toEqual(["typescript", "refactoring"]);
    expect(midCtx.verificationAttempts).toBeGreaterThanOrEqual(0);
    expect(midCtx.recoveryAttempts).toBeGreaterThanOrEqual(0);

    sm.transition("completed", "Completed successfully");
    const termCtx = sm.getContext();
    expect(termCtx.status).toBe("completed");

    // Terminal state cannot be mutated further
    const invalidAttempt = sm.transition("executing", "Re-execute");
    expect(invalidAttempt.success).toBe(false);
    expect(sm.getState()).toBe("completed");
  });
});
