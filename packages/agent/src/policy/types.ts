export type TaskRiskLevel = "low" | "normal" | "elevated" | "critical";

export interface TaskRiskContext {
  userMessage: string;
  cwd: string;
  affectedFiles: string[];
  operations: string[];
}

export interface TaskRiskAssessment {
  level: TaskRiskLevel;
  reasons: string[];
  affectedFiles: number;
  requiresCheckpoint: boolean;
  requiresExplicitApproval: boolean;
}

export interface ExecutionPolicy {
  assess(context: TaskRiskContext): TaskRiskAssessment;
}
