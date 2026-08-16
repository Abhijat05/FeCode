import * as fs from "fs/promises";
import * as path from "path";
import { getDefaultSessionsDir } from "./pathResolver.js";
import { sanitizeMessages } from "./sanitizer.js";
import type {
  PersistedSessionData,
  SessionStore,
  SessionSummary
} from "./types.js";

function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== "string") return false;
  // Prevent directory traversal or invalid path characters
  return /^[a-zA-Z0-9_.-]+$/.test(sessionId) && !sessionId.includes("..");
}

export class DefaultSessionStore implements SessionStore {
  private readonly sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir || getDefaultSessionsDir();
  }

  public getSessionsDir(): string {
    return this.sessionsDir;
  }

  public async save(session: PersistedSessionData): Promise<void> {
    if (!isValidSessionId(session.sessionId)) {
      throw new Error(`Invalid sessionId: ${session.sessionId}`);
    }

    const sanitizedMessages = sanitizeMessages(session.messages || []);
    const sanitizedData: PersistedSessionData = {
      ...session,
      version: 1,
      updatedAt: new Date().toISOString(),
      messages: sanitizedMessages
    };

    try {
      await fs.mkdir(this.sessionsDir, { recursive: true, mode: 0o700 });
    } catch {
      // Ignore directory creation error if it already exists
    }

    const tempFile = path.join(
      this.sessionsDir,
      `${session.sessionId}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`
    );
    const targetFile = path.join(this.sessionsDir, `${session.sessionId}.json`);

    const serialized = JSON.stringify(sanitizedData, null, 2);

    try {
      await fs.writeFile(tempFile, serialized, {
        encoding: "utf-8",
        mode: 0o600
      });
      await fs.rename(tempFile, targetFile);
    } catch (err: unknown) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempFile);
      } catch {
        // ignore unlink error
      }
      throw err;
    }
  }

  public async load(sessionId: string): Promise<PersistedSessionData> {
    if (!isValidSessionId(sessionId)) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }

    const targetFile = path.join(this.sessionsDir, `${sessionId}.json`);

    let raw: string;
    try {
      raw = await fs.readFile(targetFile, "utf-8");
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new Error(`Session not found: ${sessionId}`);
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Session data is corrupted.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Session data is corrupted.");
    }

    const data = parsed as Record<string, unknown>;
    if (data.version !== 1) {
      throw new Error(`Unsupported session schema version: ${data.version}`);
    }

    return parsed as PersistedSessionData;
  }

  public async list(): Promise<SessionSummary[]> {
    let files: string[] = [];
    try {
      files = await fs.readdir(this.sessionsDir);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const summaries: SessionSummary[] = [];

    for (const file of jsonFiles) {
      const filePath = path.join(this.sessionsDir, file);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.version === 1) {
          summaries.push({
            sessionId: parsed.sessionId || file.replace(/\.json$/, ""),
            workingDirectory: parsed.workingDirectory || "",
            provider: parsed.provider || "unknown",
            model: parsed.model || "unknown",
            startedAt: parsed.startedAt || new Date().toISOString(),
            updatedAt: parsed.updatedAt || parsed.startedAt || new Date().toISOString(),
            taskCount: typeof parsed.taskCount === "number" ? parsed.taskCount : 0,
            status: parsed.status || "idle"
          });
        }
      } catch {
        // Skip corrupt or unreadable session files during list
      }
    }

    return summaries.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime();
      const timeB = new Date(b.updatedAt).getTime();
      return timeB - timeA;
    });
  }

  public async delete(sessionId: string): Promise<boolean> {
    if (!isValidSessionId(sessionId)) {
      return false;
    }

    const targetFile = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      await fs.unlink(targetFile);
      return true;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }
}
