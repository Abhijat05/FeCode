import type {
  AgentRunContext,
  AgentRunFailure,
  AgentRunStateMachine,
  AgentRunStatus,
  AgentRunTransition,
  AgentRunTransitionResult
} from "./types.js";

function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `run-${timestamp}-${rand}`;
}

const LEGAL_TRANSITIONS: Record<AgentRunStatus, ReadonlySet<AgentRunStatus>> = {
  idle: new Set(["planning", "cancelled"]),
  planning: new Set(["executing", "verifying", "completed", "failed", "cancelled"]),
  executing: new Set(["verifying", "recovering", "completed", "failed", "cancelled"]),
  verifying: new Set(["executing", "recovering", "completed", "failed", "cancelled"]),
  recovering: new Set(["verifying", "executing", "completed", "failed", "cancelled"]),
  completed: new Set([]),
  failed: new Set([]),
  cancelled: new Set([])
};

export interface StateMachineOptions {
  runId?: string;
  cwd?: string;
  maxVerificationAttempts?: number;
  maxRecoveryAttempts?: number;
}

export class DefaultAgentRunStateMachine implements AgentRunStateMachine {
  private readonly context: AgentRunContext;
  private readonly transitions: AgentRunTransition[] = [];

  constructor(options: StateMachineOptions = {}) {
    this.context = {
      runId: options.runId || generateRunId(),
      startedAt: Date.now(),
      status: "idle",
      cwd: options.cwd || process.cwd(),
      verificationAttempts: 0,
      maxVerificationAttempts: options.maxVerificationAttempts ?? 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: options.maxRecoveryAttempts ?? 1
    };
  }

  public getState(): AgentRunStatus {
    return this.context.status;
  }

  public getContext(): AgentRunContext {
    return { ...this.context };
  }

  public getTransitions(): AgentRunTransition[] {
    return [...this.transitions];
  }

  public isTerminal(): boolean {
    const s = this.context.status;
    return s === "completed" || s === "failed" || s === "cancelled";
  }

  public transition(
    next: AgentRunStatus,
    reason: string
  ): AgentRunTransitionResult {
    const current = this.context.status;

    if (this.isTerminal()) {
      return {
        success: false,
        from: current,
        to: next,
        reason,
        error: `INVALID_STATE_TRANSITION: Run is already in terminal state '${current}' and cannot transition to '${next}'.`
      };
    }

    const allowed = LEGAL_TRANSITIONS[current];
    if (!allowed.has(next)) {
      return {
        success: false,
        from: current,
        to: next,
        reason,
        error: `INVALID_STATE_TRANSITION: Cannot transition from '${current}' to '${next}'.`
      };
    }

    this.context.status = next;
    const transitionEvent: AgentRunTransition = {
      timestamp: Date.now(),
      from: current,
      to: next,
      reason
    };
    this.transitions.push(transitionEvent);

    return {
      success: true,
      from: current,
      to: next,
      reason
    };
  }

  public incrementVerificationAttempts(): number {
    this.context.verificationAttempts++;
    return this.context.verificationAttempts;
  }

  public incrementRecoveryAttempts(): number {
    this.context.recoveryAttempts++;
    return this.context.recoveryAttempts;
  }

  public setActiveCheckpointId(id: string | undefined): void {
    this.context.activeCheckpointId = id;
  }

  public setActiveSkills(skills: string[]): void {
    this.context.activeSkillNames = [...skills];
  }

  public setFailure(failure: AgentRunFailure): void {
    this.context.failureReason = `${failure.code}: ${failure.message} (during ${failure.phase})`;
  }
}
