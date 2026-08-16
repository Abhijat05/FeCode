import type { ModelMessage } from "@fecode/models";
import type { TaskCompletionSummary } from "../completion/types.js";

export type SessionStatus =
  | "idle"
  | "pending"
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

export interface SessionSummary {
  sessionId: string;
  workingDirectory: string;
  provider: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  taskCount: number;
  status: SessionStatus;
}

export interface PersistedSessionData {
  version: 1;
  sessionId: string;
  workingDirectory: string;
  provider: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  taskCount: number;
  status: SessionStatus;
  completedTaskSummaries: TaskCompletionSummary[];
  messages: ModelMessage[];
}

export interface SessionStore {
  save(session: PersistedSessionData): Promise<void>;
  load(sessionId: string): Promise<PersistedSessionData>;
  list(): Promise<SessionSummary[]>;
  delete(sessionId: string): Promise<boolean>;
}
