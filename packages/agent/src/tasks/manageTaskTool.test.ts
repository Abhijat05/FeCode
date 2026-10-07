import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolContext } from "@fecode/models";
import { TaskManager } from "./taskManager.js";
import { ManageTaskTool } from "./manageTaskTool.js";

describe("ManageTaskTool", () => {
  let tempDir: string;
  let taskManager: TaskManager;
  let tool: ManageTaskTool;
  let mockContext: ToolContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fecode-manage-task-test-"));
    taskManager = new TaskManager({ logDir: tempDir });
    tool = new ManageTaskTool(taskManager);
    mockContext = {
      cwd: tempDir,
      signal: new AbortController().signal
    };
  });

  afterEach(async () => {
    await taskManager.cleanupAll();
    await new Promise((r) => setTimeout(r, 50));
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("declares name = 'manage_task' and valid input schema", () => {
    expect(tool.name).toBe("manage_task");
    expect(tool.permissionCategory).toBe("execute");
    expect(tool.inputSchema.properties.action).toBeDefined();
  });

  it("returns validation error for missing action", async () => {
    // @ts-expect-error testing missing argument
    const result = await tool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("lists tasks when action is 'list'", async () => {
    await taskManager.spawn('node -e "setInterval(() => {}, 1000);"', { cwd: tempDir });
    const result = await tool.execute({ action: "list" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(Array.isArray(result.output!.tasks)).toBe(true);
    expect(result.output!.tasks!.length).toBe(1);
    expect(result.output!.tasks![0].id).toBe("task-1");
  });

  it("returns status and log tail when action is 'status'", async () => {
    const task = await taskManager.spawn(
      'node -e "console.log(\'SERVER STARTED\'); setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );

    await new Promise((r) => setTimeout(r, 400));

    const result = await tool.execute(
      { action: "status", taskId: task.id },
      mockContext
    );

    expect(result.success).toBe(true);
    expect(result.output!.task!.id).toBe(task.id);
    expect(result.output!.task!.status).toBe("running");
    expect(result.output!.output).toContain("SERVER STARTED");
  });

  it("sends input to stdin when action is 'send_input'", async () => {
    const script = `
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (d) => {
        console.log('RECV:' + d.trim());
      });
      setInterval(() => {}, 1000);
    `;
    const task = await taskManager.spawn(
      `node -e "${script.replace(/\n/g, " ")}"`,
      { cwd: tempDir }
    );

    await new Promise((r) => setTimeout(r, 300));

    const result = await tool.execute(
      { action: "send_input", taskId: task.id, input: "test message\n" },
      mockContext
    );

    expect(result.success).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    const statusRes = await tool.execute(
      { action: "status", taskId: task.id },
      mockContext
    );
    expect(statusRes.output!.output).toContain("RECV:test message");
  });

  it("terminates task when action is 'kill'", async () => {
    const task = await taskManager.spawn(
      'node -e "setInterval(() => {}, 1000);"',
      { cwd: tempDir }
    );

    const result = await tool.execute(
      { action: "kill", taskId: task.id },
      mockContext
    );

    expect(result.success).toBe(true);
    const updated = taskManager.get(task.id);
    expect(updated?.status).toBe("killed");
  });

  it("returns error when action requires taskId but taskId is missing", async () => {
    const statusRes = await tool.execute({ action: "status" }, mockContext);
    expect(statusRes.success).toBe(false);
    expect(statusRes.error?.code).toBe("INVALID_ARGUMENT");

    const killRes = await tool.execute({ action: "kill" }, mockContext);
    expect(killRes.success).toBe(false);
    expect(killRes.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("returns error when send_input is missing input", async () => {
    const result = await tool.execute(
      { action: "send_input", taskId: "task-1" },
      mockContext
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("returns error for non-existent taskId", async () => {
    const result = await tool.execute(
      { action: "status", taskId: "task-999" },
      mockContext
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TASK_NOT_FOUND");
  });
});
