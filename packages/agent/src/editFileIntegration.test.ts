import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent, ApprovalRequest, ApprovalDecision } from "@fecode/models";
import { AutoApproveResolver, AutoDenyResolver, DefaultToolRegistry } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { ListDirectoryTool } from "./tools/listDirectory.js";
import { ReadFileTool } from "./tools/readFile.js";
import { SearchFilesTool } from "./tools/searchFiles.js";
import { WriteFileTool } from "./tools/writeFile.js";
import { EditFileTool } from "./tools/editFile.js";
import type { AgentEvent } from "./index.js";

class MockEditFileModelProvider implements ModelProvider {
  public id = "mock-edit-file-provider";
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

describe("edit_file Integration Tests with Permission Approval Pipeline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-edit-integration-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("1. Approved edit: modifies file on disk after approval", async () => {
    const provider = new MockEditFileModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new ListDirectoryTool());
    registry.register(new ReadFileTool());
    registry.register(new SearchFilesTool());
    registry.register(new WriteFileTool());
    registry.register(new EditFileTool());

    const targetFile = "src/components/Header.tsx";
    const initialContent = 'export const Header = () => <header className="old">Header</header>;\n';
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, targetFile), initialContent);

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: targetFile,
              oldText: 'className="old"',
              newText: 'className="flex items-center justify-between"'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Header component updated." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Update Header component styling",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const approvalEvent = events.find((e) => e.type === "approval_required");
    expect(approvalEvent).toBeDefined();

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(true);
      const out = toolResultEvent.result.output as { changed: boolean; replacements: number };
      expect(out.changed).toBe(true);
      expect(out.replacements).toBe(1);
    }

    const updatedContent = await fs.readFile(path.join(tmpDir, targetFile), "utf-8");
    expect(updatedContent).toContain('className="flex items-center justify-between"');
    expect(runtime.getState().status).toBe("completed");
  });

  it("2. Denied edit: leaves file untouched on disk when approval is denied ('n')", async () => {
    const provider = new MockEditFileModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new ListDirectoryTool());
    registry.register(new ReadFileTool());
    registry.register(new SearchFilesTool());
    registry.register(new WriteFileTool());
    registry.register(new EditFileTool());

    const targetFile = "src/components/Header.tsx";
    const initialContent = 'export const Header = () => <header className="old">Header</header>;\n';
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, targetFile), initialContent);

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: targetFile,
              oldText: 'className="old"',
              newText: 'className="new"'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Edit was denied." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoDenyResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Update Header component styling",
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

    const diskContent = await fs.readFile(path.join(tmpDir, targetFile), "utf-8");
    expect(diskContent).toBe(initialContent);
    expect(runtime.getState().status).toBe("completed");
  });

  it("3. Ctrl+C cancellation: leaves file untouched on disk when approval is cancelled", async () => {
    const provider = new MockEditFileModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new EditFileTool());

    const targetFile = "src/components/Header.tsx";
    const initialContent = 'export const Header = () => <header className="old">Header</header>;\n';
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, targetFile), initialContent);

    const cancellingResolver = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async resolve(_request: ApprovalRequest): Promise<ApprovalDecision> {
        return { approved: false, reason: "Cancelled via Ctrl+C." };
      }
    };

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: targetFile,
              oldText: 'className="old"',
              newText: 'className="new"'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Edit cancelled." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: cancellingResolver
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Update Header component styling",
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

    const diskContent = await fs.readFile(path.join(tmpDir, targetFile), "utf-8");
    expect(diskContent).toBe(initialContent);
  });

  it("4. Read-only tools autonomy: read_file executes automatically without approval prompts", async () => {
    const provider = new MockEditFileModelProvider();
    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool());

    const targetFile = "src/components/Header.tsx";
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, targetFile), "hello world");

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: { id: "call-read-1", name: "read_file", arguments: { path: targetFile } }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Read finished." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({ message: "Read Header.tsx", cwd: tmpDir })) {
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

  it("5. Second-read conflict protection: detects concurrent edit between reads and returns EDIT_CONFLICT", async () => {
    const provider = new MockEditFileModelProvider();
    const registry = new DefaultToolRegistry();
    const targetFile = "src/components/Header.tsx";
    const fullPath = path.join(tmpDir, targetFile);

    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(
      fullPath,
      'export const Header = () => <header className="old">Header</header>;\n'
    );

    const conflictTool = new EditFileTool({
      onPreWrite: async () => {
        // Mutate file right before second read / write!
        await fs.writeFile(
          fullPath,
          'export const Header = () => <header className="concurrently-modified">Header</header>;\n'
        );
      }
    });

    registry.register(conflictTool);

    let turn = 0;
    provider.generateFn = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-edit-1",
            name: "edit_file",
            arguments: {
              path: targetFile,
              oldText: 'className="old"',
              newText: 'className="new"'
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Edit conflicted." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      registry,
      approvalResolver: new AutoApproveResolver()
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({
      message: "Update Header component styling",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("EDIT_CONFLICT");
    }

    // Verify user's newer concurrent content remains untouched!
    const finalDiskContent = await fs.readFile(fullPath, "utf-8");
    expect(finalDiskContent).toContain('className="concurrently-modified"');
  });
});
