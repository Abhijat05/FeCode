export type SessionStatus =
  | "idle"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled";

export interface SessionInfo {
  sessionId: string;
  workingDirectory: string;
  provider: string;
  model: string;
  startedAt: Date;
  taskCount: number;
  status: SessionStatus;
}
