import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import {
  TaskManager,
  getGlobalTaskManager,
  type TaskRecord
} from "./taskManager.js";

export interface ManageTaskInput {
  action: "list" | "status" | "send_input" | "kill";
  taskId?: string;
  input?: string;
  lines?: number;
}

export interface ManageTaskOutput {
  tasks?: TaskRecord[];
  task?: TaskRecord;
  output?: string;
  message?: string;
}

export class ManageTaskTool
  implements Tool<ManageTaskInput, ManageTaskOutput> {
  public readonly name = "manage_task";
  public readonly permissionCategory = "execute";
  public readonly description =
    "Manage background daemon tasks. Use this tool to list running tasks, check status and tail output logs, send input to stdin, or terminate running background processes.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "status", "send_input", "kill"],
        description:
          "The action to perform: 'list' (list all tasks), 'status' (check status and tail recent output), 'send_input' (send input to stdin), or 'kill' (terminate process tree)."
      },
      taskId: {
        type: "string",
        description:
          "The ID of the task to manage (e.g. 'task-1'). Required for 'status', 'send_input', and 'kill'."
      },
      input: {
        type: "string",
        description:
          "The text input to send to the task's stdin. Required when action is 'send_input'."
      },
      lines: {
        type: "number",
        description:
          "Number of recent log lines to retrieve when action is 'status'. Defaults to 100."
      }
    },
    required: ["action"]
  };

  private readonly taskManager: TaskManager;

  constructor(taskManager: TaskManager = getGlobalTaskManager()) {
    this.taskManager = taskManager;
  }

  async execute(
    input: ManageTaskInput,
    _context: ToolContext
  ): Promise<ToolResult<ManageTaskOutput>> {
    if (!input || !input.action) {
      return {
        success: false,
        error: {
          message: "The 'action' parameter is required for manage_task.",
          code: "INVALID_ARGUMENT"
        }
      };
    }

    const validActions = new Set(["list", "status", "send_input", "kill"]);
    if (!validActions.has(input.action)) {
      return {
        success: false,
        error: {
          message: `Unknown action '${input.action}'. Valid actions are 'list', 'status', 'send_input', 'kill'.`,
          code: "INVALID_ARGUMENT"
        }
      };
    }

    if (input.action === "list") {
      const tasks = this.taskManager.list();
      return {
        success: true,
        output: { tasks }
      };
    }

    if (!input.taskId || typeof input.taskId !== "string" || !input.taskId.trim()) {
      return {
        success: false,
        error: {
          message: `The 'taskId' parameter is required when action is '${input.action}'.`,
          code: "INVALID_ARGUMENT"
        }
      };
    }

    const taskId = input.taskId.trim();

    if (input.action === "status") {
      const task = this.taskManager.get(taskId);
      if (!task) {
        return {
          success: false,
          error: {
            message: `Task '${taskId}' not found.`,
            code: "TASK_NOT_FOUND"
          }
        };
      }

      const output = this.taskManager.getTailOutput(taskId, input.lines ?? 100);
      return {
        success: true,
        output: {
          task,
          output
        }
      };
    }

    if (input.action === "send_input") {
      if (typeof input.input !== "string") {
        return {
          success: false,
          error: {
            message: "The 'input' parameter is required when action is 'send_input'.",
            code: "INVALID_ARGUMENT"
          }
        };
      }

      const res = await this.taskManager.sendInput(taskId, input.input);
      if (!res.success) {
        const isNotFound = res.error?.includes("TASK_NOT_FOUND");
        return {
          success: false,
          error: {
            message: res.error || "Failed to send input to task.",
            code: isNotFound ? "TASK_NOT_FOUND" : "TASK_NOT_WRITABLE"
          }
        };
      }

      return {
        success: true,
        output: {
          message: `Input sent successfully to task '${taskId}'.`
        }
      };
    }

    if (input.action === "kill") {
      const res = await this.taskManager.kill(taskId);
      if (!res.success) {
        const isNotFound = res.error?.includes("TASK_NOT_FOUND");
        return {
          success: false,
          error: {
            message: res.error || `Failed to kill task '${taskId}'.`,
            code: isNotFound ? "TASK_NOT_FOUND" : "EXECUTION_FAILED"
          }
        };
      }

      return {
        success: true,
        output: {
          message: res.message || `Task '${taskId}' killed successfully.`
        }
      };
    }

    return {
      success: false,
      error: {
        message: "Unhandled action.",
        code: "INVALID_ARGUMENT"
      }
    };
  }
}
