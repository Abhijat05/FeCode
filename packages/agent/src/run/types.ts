export type AgentRunStatus =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRunContext {
  runId: string;
  startedAt: number;
  status: AgentRunStatus;
  cwd: string;
  verificationAttempts: number;
  maxVerificationAttempts: number;
  activeCheckpointId?: string;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
  activeSkillNames?: string[];
  failureReason?: string;
}

export interface AgentRunTransition {
  timestamp: number;
  from: AgentRunStatus;
  to: AgentRunStatus;
  reason: string;
}

export interface AgentRunTransitionResult {
  success: boolean;
  from: AgentRunStatus;
  to: AgentRunStatus;
  reason: string;
  error?: string;
}

export interface AgentRunFailure {
  code: string;
  message: string;
  phase: AgentRunStatus;
}

export interface AgentRunStateMachine {
  getState(): AgentRunStatus;
  getContext(): AgentRunContext;
  getTransitions(): AgentRunTransition[];
  transition(next: AgentRunStatus, reason: string): AgentRunTransitionResult;
  isTerminal(): boolean;
  incrementVerificationAttempts(): number;
  incrementRecoveryAttempts(): number;
  setActiveCheckpointId(id: string | undefined): void;
  setActiveSkills(skills: string[]): void;
  setFailure(failure: AgentRunFailure): void;
}
