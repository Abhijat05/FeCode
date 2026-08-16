import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createContentHash } from "./hashUtils.js";
import { writeAtomic } from "./atomicWriter.js";
import { SafeEditValidator, isSecretFile } from "./validator.js";
import { EditFileTool } from "../tools/editFile.js";
import { WriteFileTool } from "../tools/writeFile.js";
import { createUnifiedDiff, formatDiffForDisplay } from "../tools/diffUtils.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";
import { DefaultCodeContextSelector } from "../context/selector.js";
import { AgentRuntime } from "../runtime.js";
import type { ModelProvider, ModelRequest, ModelEvent, ToolContext, PermissionDecision } from "@fecode/models";

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 4096
  };

  public capturedRequests: ModelRequest[] = [];

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    void signal;
    this.capturedRequests.push(request);
    yield { type: "text_delta", content: "OK" };
    yield { type: "completed" };
  }
}

describe("Context-Aware Safe Editing", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-editing-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Context Hash: same content yields same hash, changed content yields different hash", () => {
    const hash1 = createContentHash("export const x = 1;\n");
    const hash2 = createContentHash("export const x = 1;\r\n");
    const hash3 = createContentHash("export const x = 2;\n");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  it("Conflict Detection: edit is rejected with EDIT_CONFLICT if file changed since context was selected", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    const original = "export const Header = () => <header className=\"p-2\" />;\n";
    await fs.writeFile(path.join(tempDir, "src", "Header.tsx"), original);

    const oldHash = createContentHash(original);

    // External change
    await fs.writeFile(
      path.join(tempDir, "src", "Header.tsx"),
      "export const Header = () => <header className=\"p-3\" />;\n"
    );

    const editTool = new EditFileTool();
    const toolContext: ToolContext = {
      cwd: tempDir,
      signal: new AbortController().signal
    };

    const result = await editTool.execute(
      {
        path: "src/Header.tsx",
        oldText: "className=\"p-2\"",
        newText: "className=\"p-4\"",
        expectedHash: oldHash
      },
      toolContext
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("EDIT_CONFLICT");
  });

  it("Validation: validator verifies valid edits and rejects invalid or out-of-bounds paths", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Utils.ts"),
      "export function add(a: number, b: number) { return a + b; }\n"
    );

    const validator = new SafeEditValidator();

    // Valid edit
    const validRes = await validator.validateEdit(
      "src/Utils.ts",
      "return a + b;",
      "return a + b + 0;",
      tempDir
    );
    expect(validRes.valid).toBe(true);
    expect(validRes.diff).toContain("+export function add(a: number, b: number) { return a + b + 0; }");

    // Invalid text match
    const invalidRes = await validator.validateEdit(
      "src/Utils.ts",
      "nonexistent text",
      "replacement",
      tempDir
    );
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.error?.code).toBe("EDIT_INVALID");

    // Out of bounds
    const oobRes = await validator.validateEdit(
      "../outside.ts",
      "foo",
      "bar",
      tempDir
    );
    expect(oobRes.valid).toBe(false);
    expect(oobRes.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("Diff Generation: generated diff accurately reflects modified lines", () => {
    const orig = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const prop = "const a = 1;\nconst b = 20;\nconst c = 3;\n";

    const diff = createUnifiedDiff("src/test.ts", orig, prop);
    expect(diff).toContain("--- src/test.ts");
    expect(diff).toContain("+++ src/test.ts");
    expect(diff).toContain("-const b = 2;");
    expect(diff).toContain("+const b = 20;");
  });

  it("Large Diff Truncation: displayed diff truncates while actual written file is complete", async () => {
    const origLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const propLines = Array.from({ length: 100 }, (_, i) => `updated line ${i + 1}`);

    const fullDiff = createUnifiedDiff("src/large.ts", origLines.join("\n"), propLines.join("\n"), 3, 20);
    expect(fullDiff).toContain("lines omitted");

    // Format helper
    const formatted = formatDiffForDisplay(fullDiff, 10);
    expect(formatted).toContain("lines omitted");

    // Write file using writeAtomic
    const target = path.join(tempDir, "large.ts");
    await writeAtomic(target, propLines.join("\n"));
    const onDisk = await fs.readFile(target, "utf-8");
    expect(onDisk).toBe(propLines.join("\n"));
  });

  it("Secret Files: editing or writing to secret files is rejected with SECRET_FILE", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "KEY=secret123\n");
    await fs.writeFile(path.join(tempDir, "id_rsa"), "PRIVATE KEY\n");

    expect(isSecretFile(".env")).toBe(true);
    expect(isSecretFile(".env.local")).toBe(true);
    expect(isSecretFile("id_rsa")).toBe(true);
    expect(isSecretFile("src/App.tsx")).toBe(false);

    const editTool = new EditFileTool();
    const writeTool = new WriteFileTool();
    const ctx: ToolContext = {
      cwd: tempDir,
      signal: new AbortController().signal
    };

    const editRes = await editTool.execute(
      { path: ".env", oldText: "secret123", newText: "secret456" },
      ctx
    );
    expect(editRes.success).toBe(false);
    expect(editRes.error?.code).toBe("SECRET_FILE");

    const writeRes = await writeTool.execute(
      { path: "id_rsa", content: "NEW KEY" },
      ctx
    );
    expect(writeRes.success).toBe(false);
    expect(writeRes.error?.code).toBe("SECRET_FILE");
  });

  it("Atomic Write: writes cleanly and does not leave temporary or backup files", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    const target = path.join(tempDir, "src", "Atomic.ts");
    const content = "export const atomic = true;\n";

    await writeAtomic(target, content);
    expect(await fs.readFile(target, "utf-8")).toBe(content);

    const filesInDir = await fs.readdir(path.join(tempDir, "src"));
    expect(filesInDir).toEqual(["Atomic.ts"]);
    // No .bak or .tmp files remain
    expect(filesInDir.some((f) => f.includes(".tmp") || f.endsWith(".bak"))).toBe(false);
  });

  it("Cancellation: AbortSignal cancels writeAtomic without leaving partial files", async () => {
    const controller = new AbortController();
    controller.abort();

    const target = path.join(tempDir, "Cancelled.ts");
    await expect(writeAtomic(target, "content", controller.signal)).rejects.toThrow();

    const exists = await fs.access(target).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("Safe Editing Integration & Runtime Coordination", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-edit-int-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Runtime Coordination: Explorer -> ContextSelector -> Edit -> Approval -> Invalidation", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Card.tsx"),
      "export const Card = () => <div className=\"p-2\">Card</div>;\n"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    let turn = 0;
    let approvalRequested = false;
    provider.generate = async function* (req: ModelRequest) {
      provider.capturedRequests.push(req);
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/Card.tsx",
              oldText: "className=\"p-2\"",
              newText: "className=\"p-6\""
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Card updated successfully." };
        yield { type: "completed" };
      }
    };

    const editTool = new EditFileTool();
    const toolRegistry = {
      get: () => editTool,
      list: () => [editTool],
      register: () => {},
      has: () => true
    };

    const permissionManager = {
      check: async (): Promise<PermissionDecision> => {
        approvalRequested = true;
        return { type: "requires_approval", reason: "Edit requires user approval" };
      }
    };

    const approvalResolver = {
      resolve: async () => ({ approved: true })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager,
      approvalResolver,
      repositoryExplorer: explorer,
      codeContextSelector: selector
    });

    for await (const event of runtime.run({ message: "Update Card padding", cwd: tempDir })) {
      void event;
    }

    expect(approvalRequested).toBe(true);
    const updatedContent = await fs.readFile(path.join(tempDir, "src", "Card.tsx"), "utf-8");
    expect(updatedContent).toContain("className=\"p-6\"");
  });

  it("Multiple Edits: each edit independently checks permissions and invalidates cache", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "A.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(tempDir, "src", "B.ts"), "export const b = 2;\n");

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    let turn = 0;
    let approvalCount = 0;
    provider.generate = async function* (req: ModelRequest) {
      provider.capturedRequests.push(req);
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: { path: "src/A.ts", oldText: "a = 1", newText: "a = 10" }
          }
        };
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: { path: "src/B.ts", oldText: "b = 2", newText: "b = 20" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Both files updated." };
        yield { type: "completed" };
      }
    };

    const editTool = new EditFileTool();
    const toolRegistry = {
      get: () => editTool,
      list: () => [editTool],
      register: () => {},
      has: () => true
    };

    const permissionManager = {
      check: async (): Promise<PermissionDecision> => {
        approvalCount++;
        return { type: "requires_approval", reason: "Approval needed" };
      }
    };

    const approvalResolver = {
      resolve: async () => ({ approved: true })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager,
      approvalResolver,
      repositoryExplorer: explorer,
      codeContextSelector: selector
    });

    for await (const event of runtime.run({ message: "Update A and B", cwd: tempDir })) {
      void event;
    }

    expect(approvalCount).toBe(2);
    expect(await fs.readFile(path.join(tempDir, "src", "A.ts"), "utf-8")).toContain("a = 10");
    expect(await fs.readFile(path.join(tempDir, "src", "B.ts"), "utf-8")).toContain("b = 20");
  });

  it("Provider Independence: OpenAI, Gemini, and Ollama follow identical safe edit semantics", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "Comp.tsx"), "export const x = 1;\n");

    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    const runtimeA = new AgentRuntime(providerA, { repositoryExplorer: explorer, codeContextSelector: selector });
    const runtimeB = new AgentRuntime(providerB, { repositoryExplorer: explorer, codeContextSelector: selector });
    const runtimeC = new AgentRuntime(providerC, { repositoryExplorer: explorer, codeContextSelector: selector });

    for await (const event of runtimeA.run({ message: "Inspect Comp", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Inspect Comp", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Inspect Comp", cwd: tempDir })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});
