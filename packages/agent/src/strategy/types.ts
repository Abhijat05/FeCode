import type { ProjectProfile } from "../project/types.js";
import type { Skill } from "../skills/types.js";
import type { TaskPlan } from "../tasks/types.js";

export type ExecutionIntent =
  | "answer"
  | "explore"
  | "inspect"
  | "implement"
  | "verify";

export type ExecutionPhase =
  | "idle"
  | "understanding"
  | "exploring"
  | "planning"
  | "implementing"
  | "verifying"
  | "completed"
  | "blocked";

export interface AgentExecutionDecision {
  intent: ExecutionIntent;
  phase: ExecutionPhase;
  shouldExplore: boolean;
  shouldSelectContext: boolean;
  requiresPlanning: boolean;
  recommendedTools: string[];
  guidance?: string;
}

export interface DecisionContext {
  projectProfile?: ProjectProfile;
  activeSkills?: Skill[];
  activePlan?: TaskPlan;
  verificationAttempts?: number;
}

export interface AgentExecutionStrategy {
  decide(message: string, context?: DecisionContext): AgentExecutionDecision;
}
