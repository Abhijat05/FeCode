import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
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

  it("executes write_file when approved by resolver and creates file on disk", async () => {
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

    const approvalEvent = events.find((e) => e.type === "approval_required");
    expect(approvalEvent).toBeDefined();
    if (approvalEvent && approvalEvent.type === "approval_required") {
      expect(approvalEvent.request.toolName).toBe("write_file");
      expect(approvalEvent.request.category).toBe("write");
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
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

  it("does not modify file on disk when approval is denied", async () => {
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
});
