import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent, ApprovalRequest, ApprovalDecision } from "@fecode/models";
import { AutoApproveResolver, AutoDenyResolver } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import type { AgentEvent } from "./index.js";

class MockWriteFileModelProvider implements ModelProvider {
  public id = "mock-write-file-provider";
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

describe("write_file Integration Tests with Permission Approval Pipeline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-write-integration-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("1. Real write flow: executes write_file when approved by resolver and creates file on disk", async () => {
    const provider = new MockWriteFileModelProvider();
    const registry = createDefaultToolRegistry();

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-write-1",
            name: "write_file",
            arguments: {
              path: "src/components/TestButton.tsx",
              content: "export const TestButton = () => <button>Test</button>;\n"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Component TestButton.tsx created." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Create src/components/TestButton.tsx",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const approvalIndex = events.findIndex((e) => e.type === "approval_required");
    const resultIndex = events.findIndex((e) => e.type === "tool_result");

    expect(approvalIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeGreaterThan(approvalIndex); // Approval prompt appears BEFORE write result!

    const approvalEvent = events[approvalIndex];
    if (approvalEvent && approvalEvent.type === "approval_required") {
      expect(approvalEvent.request.toolName).toBe("write_file");
      expect(approvalEvent.request.category).toBe("write");
    }

    const toolResultEvent = events[resultIndex];
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(true);
      const out = toolResultEvent.result.output as { created: boolean };
      expect(out.created).toBe(true);
    }

    const createdContent = await fs.readFile(
      path.join(tmpDir, "src", "components", "TestButton.tsx"),
      "utf-8"
    );
    expect(createdContent).toBe("export const TestButton = () => <button>Test</button>;\n");
    expect(runtime.getState().status).toBe("completed");
  });

  it("2. Denial: does not modify file on disk when approval is denied ('n')", async () => {
    const provider = new MockWriteFileModelProvider();
    const registry = createDefaultToolRegistry();

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-write-1",
            name: "write_file",
            arguments: {
              path: "src/components/TestButton.tsx",
              content: "export const TestButton = () => <button>Test</button>;\n"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Write was denied." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoDenyResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Create src/components/TestButton.tsx",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("PERMISSION_DENIED");
    }

    // Verify target file was NOT created on disk
    let fileExists = false;
    try {
      await fs.stat(path.join(tmpDir, "src", "components", "TestButton.tsx"));
      fileExists = true;
    } catch {
      fileExists = false;
    }

    expect(fileExists).toBe(false);
    expect(runtime.getState().status).toBe("completed");
  });

  it("3. Ctrl+C: cancelling approval request leaves file uncreated on disk", async () => {
    const provider = new MockWriteFileModelProvider();
    const registry = createDefaultToolRegistry();

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-write-1",
            name: "write_file",
            arguments: {
              path: "src/components/TestButton.tsx",
              content: "export const TestButton = () => <button>Test</button>;\n"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Write was cancelled." };
        yield { type: "completed" };
      }
    };

    const cancellingResolver = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async resolve(_request: ApprovalRequest): Promise<ApprovalDecision> {
        return { approved: false, reason: "Cancelled via Ctrl+C." };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: cancellingResolver
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Create src/components/TestButton.tsx",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("PERMISSION_DENIED");
      expect(toolResultEvent.result.error?.message).toContain("Ctrl+C");
    }

    let fileExists = false;
    try {
      await fs.stat(path.join(tmpDir, "src", "components", "TestButton.tsx"));
      fileExists = true;
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });

  it("4. Read tools execute automatically without approval prompts", async () => {
    const provider = new MockWriteFileModelProvider();
    const registry = createDefaultToolRegistry();

    await fs.writeFile(path.join(tmpDir, "existing.txt"), "hello world");

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-read-1", name: "read_file", arguments: { path: "existing.txt" } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Read finished." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Read existing.txt", cwd: tmpDir })) {
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
});
