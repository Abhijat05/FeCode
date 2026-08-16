import type { SessionInfo, SessionStatus } from "./types.js";

export class AgentSession {
  public readonly sessionId: string;
  public readonly workingDirectory: string;
  public readonly provider: string;
  public readonly model: string;
  public readonly startedAt: Date;
  private _taskCount: number = 0;
  private _status: SessionStatus = "idle";

  constructor(options: {
    sessionId?: string;
    workingDirectory: string;
    provider: string;
    model: string;
    startedAt?: Date;
  }) {
    this.sessionId =
      options.sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.workingDirectory = options.workingDirectory;
    this.provider = options.provider;
    this.model = options.model;
    this.startedAt = options.startedAt || new Date();
  }

  public get taskCount(): number {
    return this._taskCount;
  }

  public incrementTaskCount(): void {
    this._taskCount++;
  }

  public get status(): SessionStatus {
    return this._status;
  }

  public setStatus(status: SessionStatus): void {
    this._status = status;
  }

  public getInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      workingDirectory: this.workingDirectory,
      provider: this.provider,
      model: this.model,
      startedAt: this.startedAt,
      taskCount: this._taskCount,
      status: this._status
    };
  }
}
