import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { killProcessTree } from "../commands/processTree.js";
import { prepareChildEnvironment } from "../commands/nodeExecutor.js";
import { DefaultCommandPolicy } from "../commands/policy.js";
import type { CommandPolicy } from "../commands/types.js";

export type BackgroundTaskStatus = "running" | "exited" | "killed" | "failed";

export interface TaskRecord {
  id: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  logFile: string;
  error?: string;
}

export interface TaskManagerOptions {
  logDir?: string;
  policy?: CommandPolicy;
  maxRingBufferLines?: number;
}

export interface SendInputResult {
  success: boolean;
  error?: string;
}

export interface KillTaskResult {
  success: boolean;
  message?: string;
  error?: string;
}

export class TaskManager {
  private counter = 0;
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly ringBuffers = new Map<string, string[]>();
  private readonly logStreams = new Map<string, fs.WriteStream>();
  private readonly logDir: string;
  private readonly policy: CommandPolicy;
  private readonly maxRingBufferLines: number;

  constructor(options?: TaskManagerOptions) {
    this.logDir = options?.logDir ?? path.join(os.homedir(), ".fecode", "tasks");
    this.policy = options?.policy ?? new DefaultCommandPolicy();
    this.maxRingBufferLines = options?.maxRingBufferLines ?? 1000;

    // Register cleanup on process exit
    const exitHandler = () => {
      this.cleanupAllSync();
    };
    process.once("exit", exitHandler);
  }

  public async spawn(
    command: string,
    options: { cwd: string; signal?: AbortSignal }
  ): Promise<TaskRecord> {
    const decision = this.policy.validate(command);
    if (decision.type === "denied") {
      throw new Error(`${decision.code}: ${decision.reason}`);
    }

    const executable = decision.executable!;
    const args = decision.args || [];
    const childEnv = prepareChildEnvironment();

    const taskId = `task-${++this.counter}`;
    fs.mkdirSync(this.logDir, { recursive: true });
    const logFile = path.join(this.logDir, `${taskId}.log`);
    let logFd: number | undefined;
    try {
      logFd = fs.openSync(logFile, "a");
    } catch {
      // Fallback if openSync fails
    }

    const logStream =
      logFd !== undefined
        ? fs.createWriteStream(logFile, { fd: logFd, flags: "a" })
        : fs.createWriteStream(logFile, { flags: "a" });

    // CRITICAL: Prevent unhandled stream error events (e.g. if file is unlinked during test teardown)
    logStream.on("error", () => {
      // Suppress unhandled stream error
    });
    this.logStreams.set(taskId, logStream);

    const ringBuffer: string[] = [];
    this.ringBuffers.set(taskId, ringBuffer);

    const BATCH_EXECUTABLES = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
    const useShell =
      process.platform === "win32" && BATCH_EXECUTABLES.has(executable.toLowerCase());

    let child: ChildProcess;
    try {
      if (useShell) {
        child = spawn(command.trim(), [], {
          cwd: options.cwd,
          env: childEnv,
          shell: true,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } else {
        child = spawn(executable, args, {
          cwd: options.cwd,
          env: childEnv,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      }
    } catch (err: unknown) {
      logStream.end();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const failedRecord: TaskRecord = {
        id: taskId,
        command,
        cwd: options.cwd,
        pid: null,
        status: "failed",
        exitCode: null,
        startedAt: Date.now(),
        endedAt: Date.now(),
        logFile,
        error: `Failed to spawn process: ${errorMsg}`
      };
      this.tasks.set(taskId, failedRecord);
      return failedRecord;
    }

    const record: TaskRecord = {
      id: taskId,
      command,
      cwd: options.cwd,
      pid: child.pid ?? null,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      logFile
    };

    this.tasks.set(taskId, record);
    this.processes.set(taskId, child);

    const appendToBuffer = (data: Buffer | string) => {
      const text = data.toString();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line) {
          ringBuffer.push(line);
          if (ringBuffer.length > this.maxRingBufferLines) {
            ringBuffer.shift();
          }
        }
      }
    };

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        if (!logStream.destroyed && logStream.writable) {
          try {
            logStream.write(chunk);
          } catch {
            // Ignore write errors
          }
        }
        appendToBuffer(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        if (!logStream.destroyed && logStream.writable) {
          try {
            logStream.write(chunk);
          } catch {
            // Ignore write errors
          }
        }
        appendToBuffer(chunk);
      });
    }

    child.on("error", (err: Error) => {
      if (record.status === "running") {
        record.status = "failed";
        record.error = err.message;
        record.endedAt = Date.now();
      }
      if (!logStream.destroyed) {
        try {
          logStream.end();
        } catch {
          // Ignore
        }
      }
    });

    child.on("close", (code: number | null) => {
      if (record.status === "running") {
        record.status = "exited";
        record.exitCode = code;
        record.endedAt = Date.now();
      }
      if (!logStream.destroyed) {
        try {
          logStream.end();
        } catch {
          // Ignore
        }
      }
    });

    if (options.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          this.kill(taskId).catch(() => {});
        },
        { once: true }
      );
    }

    return record;
  }

  public list(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  public get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  public getTailOutput(taskId: string, lines = 100): string {
    const buffer = this.ringBuffers.get(taskId);
    if (!buffer || buffer.length === 0) {
      return "";
    }
    return buffer.slice(-lines).join("\n");
  }

  public async sendInput(taskId: string, input: string): Promise<SendInputResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `TASK_NOT_FOUND: Task '${taskId}' does not exist.` };
    }

    if (task.status !== "running") {
      return {
        success: false,
        error: `TASK_NOT_WRITABLE: Task '${taskId}' is in status '${task.status}'.`
      };
    }

    const child = this.processes.get(taskId);
    if (!child || !child.stdin || !child.stdin.writable) {
      return {
        success: false,
        error: `TASK_NOT_WRITABLE: stdin for task '${taskId}' is not available or closed.`
      };
    }

    return new Promise<SendInputResult>((resolve) => {
      child.stdin!.write(input, "utf-8", (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  public async kill(taskId: string): Promise<KillTaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `TASK_NOT_FOUND: Task '${taskId}' does not exist.` };
    }

    if (task.status !== "running") {
      const stream = this.logStreams.get(taskId);
      if (stream && !stream.destroyed) {
        try {
          stream.destroy();
        } catch {
          // Ignore
        }
      }
      return { success: true, message: `Task '${taskId}' is already in status '${task.status}'.` };
    }

    const child = this.processes.get(taskId);
    if (child) {
      try {
        killProcessTree(child, "SIGKILL");
        child.kill("SIGKILL");
      } catch {
        // Ignore
      }
    }

    task.status = "killed";
    task.endedAt = Date.now();

    const stream = this.logStreams.get(taskId);
    if (stream && !stream.destroyed) {
      try {
        stream.destroy();
      } catch {
        // Ignore
      }
    }

    return { success: true };
  }

  public async cleanupAll(): Promise<void> {
    for (const [, child] of this.processes.entries()) {
      try {
        killProcessTree(child, "SIGKILL");
        child.kill("SIGKILL");
      } catch {
        // Ignore
      }
    }
    for (const stream of this.logStreams.values()) {
      try {
        if (!stream.destroyed) {
          stream.destroy();
        }
      } catch {
        // Ignore
      }
    }
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.status = "killed";
        task.endedAt = Date.now();
      }
    }
  }

  private cleanupAllSync(): void {
    for (const [taskId, child] of this.processes.entries()) {
      try {
        killProcessTree(child, "SIGKILL");
        child.kill("SIGKILL");
      } catch {
        // Ignore
      }
      const stream = this.logStreams.get(taskId);
      if (stream && !stream.destroyed) {
        try {
          stream.destroy();
        } catch {
          // Ignore
        }
      }
    }
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.status = "killed";
        task.endedAt = Date.now();
      }
    }
  }
}

let globalTaskManager: TaskManager | null = null;

export function getGlobalTaskManager(options?: TaskManagerOptions): TaskManager {
  if (!globalTaskManager) {
    globalTaskManager = new TaskManager(options);
  }
  return globalTaskManager;
}
