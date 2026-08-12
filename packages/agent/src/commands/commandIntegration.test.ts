import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AutoApproveResolver, AutoDenyResolver } from "@fecode/models";
import { AgentRuntime } from "../runtime.js";
import { createDefaultToolRegistry } from "../tools/defaultRegistry.js";
import { ExecuteCommandTool } from "./executeCommandTool.js";
import { MockCommandExecutor } from "./mockExecutor.js";
import type { AgentEvent } from "../index.js";

class MockCommandModelProvider implements ModelProvider {
  public id = "mock-cmd-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  public generateFn?: (
    request: ModelRequest,
    signal?: AbortSignal
  ) => AsyncIterable<ModelEvent>;

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    if (this.generateFn) {
      yield* this.generateFn(request, signal);
      return;
    }
  }
}

describe("Command Execution Architecture Integration Tests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cmd-integration-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("verifies createDefaultToolRegistry includes execute_command tool with execute category", () => {
    const registry = createDefaultToolRegistry();
    const tool = registry.get("execute_command");
    expect(tool).toBeDefined();
    expect(tool?.permissionCategory).toBe("execute");
    expect(registry.list().map((t) => t.name)).toContain("execute_command");
  });

  it("triggers permission approval for execute category when execute_command is invoked", async () => {
    const provider = new MockCommandModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-cmd-1",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Tests passed." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Run unit tests",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const approvalEvent = events.find((e) => e.type === "approval_required");
    expect(approvalEvent).toBeDefined();
    if (approvalEvent && approvalEvent.type === "approval_required") {
      expect(approvalEvent.request.toolName).toBe("execute_command");
      expect(approvalEvent.request.category).toBe("execute");
    }

    expect(mockExecutor.executedCommands).toHaveLength(1);
    expect(mockExecutor.executedCommands[0].command).toBe("npm test");

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "tool_result") {
      expect(resultEvent.result.success).toBe(true);
    }
  });

  it("prevents command execution when approval is denied", async () => {
    const provider = new MockCommandModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-cmd-1",
            name: "execute_command",
            arguments: { command: "npm test" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Command execution was denied." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoDenyResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Run unit tests",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    expect(mockExecutor.executedCommands).toHaveLength(0);

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "tool_result") {
      expect(resultEvent.result.success).toBe(false);
      expect(resultEvent.result.error?.code).toBe("PERMISSION_DENIED");
    }
  });
});
