import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TaskManager } from "./taskManager.js";

describe("TaskManager", () => {
  let tempDir: string;
  let taskManager: TaskManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fecode-task-manager-test-"));
    taskManager = new TaskManager({ logDir: tempDir });
  });

  afterEach(async () => {
    await taskManager.cleanupAll();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("spawns a background task and returns task record with running status", async () => {
    const record = await taskManager.spawn(
      'node -e "console.log(\'hello from background\'); setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );

    expect(record.id).toMatch(/^task-\d+$/);
    expect(record.status).toBe("running");
    expect(record.pid).toBeTypeOf("number");
    expect(record.pid).toBeGreaterThan(0);
    expect(fs.existsSync(record.logFile)).toBe(true);

    // Wait briefly for output to flush
    await new Promise((r) => setTimeout(r, 400));

    const tail = taskManager.getTailOutput(record.id);
    expect(tail).toContain("hello from background");
  });

  it("lists all registered tasks", async () => {
    const task1 = await taskManager.spawn(
      'node -e "setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );
    const task2 = await taskManager.spawn(
      'node -e "setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );

    const list = taskManager.list();
    expect(list.length).toBe(2);
    expect(list.map((t) => t.id)).toEqual([task1.id, task2.id]);
  });

  it("sends input to stdin of a running task", async () => {
    const script = `
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (d) => {
        console.log('ECHO:' + d.trim());
      });
      setInterval(() => {}, 1000);
    `;
    const record = await taskManager.spawn(
      `node -e "${script.replace(/\n/g, " ")}"`,
      { cwd: tempDir }
    );

    await new Promise((r) => setTimeout(r, 300));
    const sent = await taskManager.sendInput(record.id, "ping\n");
    expect(sent.success).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    const tail = taskManager.getTailOutput(record.id);
    expect(tail).toContain("ECHO:ping");
  });

  it("kills a running task and marks status as killed", async () => {
    const record = await taskManager.spawn(
      'node -e "setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );
    expect(record.status).toBe("running");

    const killResult = await taskManager.kill(record.id);
    expect(killResult.success).toBe(true);

    const updated = taskManager.get(record.id);
    expect(updated?.status).toBe("killed");
    expect(updated?.endedAt).toBeTypeOf("number");
  });

  it("handles naturally exiting processes", async () => {
    const record = await taskManager.spawn(
      'node -e "console.log(\'done\'); process.exit(0);"',
      { cwd: tempDir }
    );

    await new Promise((r) => setTimeout(r, 600));

    const updated = taskManager.get(record.id);
    expect(updated?.status).toBe("exited");
    expect(updated?.exitCode).toBe(0);
  });

  it("rejects unauthorized commands based on policy", async () => {
    await expect(
      taskManager.spawn("rm -rf /", { cwd: tempDir })
    ).rejects.toThrow(/COMMAND_NOT_ALLOWED/);
  });

  it("handles non-existent task IDs safely", async () => {
    expect(taskManager.get("task-999")).toBeUndefined();
    expect(taskManager.getTailOutput("task-999")).toBe("");

    const killResult = await taskManager.kill("task-999");
    expect(killResult.success).toBe(false);
    expect(killResult.error).toContain("TASK_NOT_FOUND");

    const inputResult = await taskManager.sendInput("task-999", "hello");
    expect(inputResult.success).toBe(false);
    expect(inputResult.error).toContain("TASK_NOT_FOUND");
  });

  it("cleans up all running tasks in bulk", async () => {
    const task1 = await taskManager.spawn('node -e "setInterval(() => {}, 1000);"', { cwd: tempDir });
    const task2 = await taskManager.spawn('node -e "setInterval(() => {}, 1000);"', { cwd: tempDir });

    expect(taskManager.get(task1.id)?.status).toBe("running");
    expect(taskManager.get(task2.id)?.status).toBe("running");

    await taskManager.cleanupAll();

    expect(taskManager.get(task1.id)?.status).toBe("killed");
    expect(taskManager.get(task2.id)?.status).toBe("killed");
  });
});
