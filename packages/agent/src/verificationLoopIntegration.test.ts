import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AutoApproveResolver, AutoDenyResolver } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import { EditFileTool } from "./tools/editFile.js";
import { ExecuteCommandTool } from "./commands/executeCommandTool.js";
import { MockCommandExecutor } from "./commands/mockExecutor.js";
import type { AgentEvent } from "./index.js";

class VerificationModelProvider implements ModelProvider {
  public id = "verification-model-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 4096
  };

  public turns: Array<(request: ModelRequest) => AsyncIterable<ModelEvent>> = [];
  public currentTurn = 0;

  async *generate(
    request: ModelRequest
  ): AsyncIterable<ModelEvent> {
    if (this.currentTurn < this.turns.length) {
      const turnFn = this.turns[this.currentTurn];
      this.currentTurn++;
      yield* turnFn(request);
    } else {
      yield { type: "text_delta", content: "Done." };
      yield { type: "completed" };
    }
  }
}

describe("Verification Loop Integration Tests", () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-verify-loop-"));
    testFile = path.join(tmpDir, "src", "Header.tsx");
    await fs.mkdir(path.dirname(testFile), { recursive: true });
    await fs.writeFile(testFile, "export const Header = () => <h1>Hello</h1>;");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("1. Edit → Verify Success (exitCode 0)", async () => {
    const provider = new VerificationModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    mockExecutor.defaultResult = {
      exitCode: 0,
      stdout: "Typecheck passed cleanly.",
      stderr: "",
      timedOut: false,
      truncated: false
    };

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello</h1>",
              newText: "<h1>Hello World</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-cmd-1",
            name: "execute_command",
            arguments: { command: "npm run typecheck" }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield { type: "text_delta", content: "Edit verified successfully." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Update Header text and verify",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const contentOnDisk = await fs.readFile(testFile, "utf-8");
    expect(contentOnDisk).toContain("<h1>Hello World</h1>");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.map((e) => (e as { content: string }).content).join("")).toContain("Edit verified");
  });

  it("2. Failure + Fix Loop (Attempt 1 fails -> Model edits -> Attempt 2 passes)", async () => {
    const provider = new VerificationModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    mockExecutor.customResponses.set("npm run typecheck", {
      command: "npm run typecheck",
      exitCode: 1,
      stdout: "",
      stderr: "TS2322: Type 'string' is not assignable to type 'number'",
      timedOut: false,
      truncated: false
    });

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello</h1>",
              newText: "<h1>Hello Bad</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-cmd-1",
            name: "execute_command",
            arguments: { command: "npm run typecheck" }
          }
        };
        yield { type: "completed" };
      },
      async function* (request: ModelRequest) {
        const lastMsg = request.messages[request.messages.length - 1];
        expect(lastMsg.content).toContain("TS2322");

        // Set mock to succeed on next call
        mockExecutor.customResponses.set("npm run typecheck", {
          command: "npm run typecheck",
          exitCode: 0,
          stdout: "Typecheck passed.",
          stderr: "",
          timedOut: false,
          truncated: false
        });

        yield {
          type: "tool_call",
          call: {
            id: "call-edit-2",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello Bad</h1>",
              newText: "<h1>Hello Fixed</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-cmd-2",
            name: "execute_command",
            arguments: { command: "npm run typecheck" }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield { type: "text_delta", content: "TypeScript errors resolved." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Fix type error",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const contentOnDisk = await fs.readFile(testFile, "utf-8");
    expect(contentOnDisk).toContain("<h1>Hello Fixed</h1>");
    expect(mockExecutor.executedCommands).toHaveLength(2);
  });

  it("3. Maximum Attempts Bounded Halting (3 attempts fail -> loop stops)", async () => {
    const provider = new VerificationModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    mockExecutor.defaultResult = {
      exitCode: 1,
      stdout: "",
      stderr: "Persistent error",
      timedOut: false,
      truncated: false
    };

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: { id: "cmd-1", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: { id: "cmd-2", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: { id: "cmd-3", name: "execute_command", arguments: { command: "npm test" } }
        };
        yield { type: "completed" };
      },
      async function* (request: ModelRequest) {
        const lastMsg = request.messages[request.messages.length - 1];
        expect(lastMsg.content).toContain("Maximum verification attempts (3) reached");
        yield { type: "text_delta", content: "Failed to fix after 3 attempts." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver(),
      maxVerificationAttempts: 3
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Run tests",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    expect(mockExecutor.executedCommands).toHaveLength(3);
    const state = runtime.getState();
    expect(state.verificationAttempts).toBe(3);
  });

  it("4. Permission Denial Handling (denied edit/command returns PERMISSION_DENIED without auto-retry)", async () => {
    const provider = new VerificationModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello</h1>",
              newText: "<h1>Hello Modified</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* (request: ModelRequest) {
        const toolResultMsg = request.messages[request.messages.length - 1];
        expect(toolResultMsg.content).toContain("PERMISSION_DENIED");
        yield { type: "text_delta", content: "Edit was denied by user." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoDenyResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Edit component",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const contentOnDisk = await fs.readFile(testFile, "utf-8");
    expect(contentOnDisk).toBe("export const Header = () => <h1>Hello</h1>;");
  });

  it("5. EDIT_CONFLICT handling allows model to re-read and apply valid edit", async () => {
    const provider = new VerificationModelProvider();
    const registry = createDefaultToolRegistry();

    // Register custom EditFileTool with onPreWrite hook simulating concurrent file edit
    let conflictSimulated = false;
    registry.register(
      new EditFileTool({
        onPreWrite: async () => {
          if (!conflictSimulated) {
            conflictSimulated = true;
            await fs.writeFile(testFile, "export const Header = () => <h1>Hello Concurrent</h1>;");
          }
        }
      })
    );

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello</h1>",
              newText: "<h1>Hello Edit 1</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* (request: ModelRequest) {
        const toolResultMsg = request.messages[request.messages.length - 1];
        expect(toolResultMsg.content).toContain("EDIT_CONFLICT");

        yield {
          type: "tool_call",
          call: {
            id: "call-edit-2",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello Concurrent</h1>",
              newText: "<h1>Hello Edit 2</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield { type: "text_delta", content: "Recovered from edit conflict." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Edit header",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const contentOnDisk = await fs.readFile(testFile, "utf-8");
    expect(contentOnDisk).toContain("<h1>Hello Edit 2</h1>");
  });

  it("6. Chronological conversation history preservation", async () => {
    const provider = new VerificationModelProvider();
    const mockExecutor = new MockCommandExecutor();
    const registry = createDefaultToolRegistry();
    registry.register(new ExecuteCommandTool(mockExecutor));

    provider.turns = [
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "read_file",
            arguments: { path: "src/Header.tsx" }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: {
              path: "src/Header.tsx",
              oldText: "<h1>Hello</h1>",
              newText: "<h1>Hello World</h1>"
            }
          }
        };
        yield { type: "completed" };
      },
      async function* () {
        yield { type: "text_delta", content: "Done editing." };
        yield { type: "completed" };
      }
    ];

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    for await (const event of runtime.run({
      message: "Read and update header",
      cwd: tmpDir
    })) {
      void event;
    }

    const state = runtime.getState();
    const roles = state.messages.map((m) => m.role);
    expect(roles).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant"
    ]);
  });
});
