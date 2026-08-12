import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { DefaultToolRegistry, AutoApproveResolver, AutoDenyResolver } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { ListDirectoryTool } from "./tools/listDirectory.js";
import { ReadFileTool } from "./tools/readFile.js";
import { MockWriteTool } from "./tools/mockWriteTool.js";
import type { AgentEvent } from "./index.js";

class MockPermissionModelProvider implements ModelProvider {
  public id = "mock-permission-provider";
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

describe("Permission and Approval Integration Tests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-perm-test-"));
    await fs.writeFile(path.join(tmpDir, "sample.txt"), "hello world");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("1. Read tools (read_file, list_directory) execute automatically without approval_required events", async () => {
    const provider = new MockPermissionModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new ListDirectoryTool());
    registry.register(new ReadFileTool());

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-read-1", name: "read_file", arguments: { path: "sample.txt" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "File content read successfully." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Read sample.txt", cwd: tmpDir })) {
      events.push(event);
    }

    const approvalEvents = events.filter((e) => e.type === "approval_required");
    expect(approvalEvents).toHaveLength(0);

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "tool_result") {
      expect(resultEvent.result.success).toBe(true);
    }
  });

  it("2. Write tools (mock_write) emit approval_required and execute when approved", async () => {
    const provider = new MockPermissionModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new MockWriteTool());

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-write-1", name: "mock_write", arguments: { path: "new.txt", content: "test" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Write approved and completed." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Write new.txt", cwd: tmpDir })) {
      events.push(event);
    }

    const approvalEvent = events.find((e) => e.type === "approval_required");
    expect(approvalEvent).toBeDefined();
    if (approvalEvent && approvalEvent.type === "approval_required") {
      expect(approvalEvent.request.toolName).toBe("mock_write");
      expect(approvalEvent.request.category).toBe("write");
    }

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "tool_result") {
      expect(resultEvent.result.success).toBe(true);
    }
  });

  it("3. Write tools (mock_write) emit approval_required and return PERMISSION_DENIED when denied", async () => {
    const provider = new MockPermissionModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new MockWriteTool());

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-write-1", name: "mock_write", arguments: { path: "new.txt", content: "test" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Understood, write was denied." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoDenyResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Write new.txt", cwd: tmpDir })) {
      events.push(event);
    }

    const approvalEvent = events.find((e) => e.type === "approval_required");
    expect(approvalEvent).toBeDefined();

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "tool_result") {
      expect(resultEvent.result.success).toBe(false);
      expect(resultEvent.result.error?.code).toBe("PERMISSION_DENIED");
    }

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
    expect(runtime.getState().status).toBe("completed");
  });
});
