import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createDefaultToolRegistry } from "../tools/defaultRegistry.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelEvent,
  ApprovalResolver,
  ApprovalRequest,
  ApprovalDecision
} from "@fecode/models";
import type { ChangeReview } from "./changeReview.js";

class MockProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 8192
  };

  public capturedRequests: ModelRequest[] = [];
  public generateHandler?: (
    request: ModelRequest,
    signal?: AbortSignal
  ) => AsyncIterable<ModelEvent>;

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    this.capturedRequests.push(request);
    if (this.generateHandler) {
      yield* this.generateHandler(request, signal);
    } else {
      yield { type: "text_delta", content: "Done." };
      yield { type: "completed" };
    }
  }
}

describe("Change Review & Pre-Validation Integration — Phase 5D", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-review-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("pre-validates and rejects secret file edits without requesting approval", async () => {
    let approvalRequested = false;
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => {
        approvalRequested = true;
        return { approved: true };
      }
    };

    let callCount = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: ".env",
              oldText: "SECRET=old",
              newText: "SECRET=new"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Understood, secret files are blocked." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Edit env file", cwd: tmpDir })) {
      events.push(ev);
    }

    expect(approvalRequested).toBe(false);
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("SECRET_FILE");
    }
  });

  it("detects stale edit conflict and returns error without requesting approval", async () => {
    const filePath = path.join(tmpDir, "app.ts");
    await fs.writeFile(filePath, "const a = 100;", "utf-8");

    let approvalRequested = false;
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => {
        approvalRequested = true;
        return { approved: true };
      }
    };

    let callCount = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "app.ts",
              oldText: "const a = 1;", // Mismatched old text
              newText: "const a = 2;"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Understood." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Edit app.ts", cwd: tmpDir })) {
      events.push(ev);
    }

    expect(approvalRequested).toBe(false);
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("EDIT_INVALID");
    }
  });

  it("detects no-op edit and returns success without requesting approval", async () => {
    const filePath = path.join(tmpDir, "app.ts");
    await fs.writeFile(filePath, "const a = 1;", "utf-8");

    let approvalRequested = false;
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => {
        approvalRequested = true;
        return { approved: true };
      }
    };

    let callCount = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "app.ts",
              oldText: "const a = 1;",
              newText: "const a = 1;" // Identical replacement
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "No changes needed." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "No-op edit", cwd: tmpDir })) {
      events.push(ev);
    }

    expect(approvalRequested).toBe(false);
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(true);
      const out = toolResultEvent.result.output as { changed?: boolean; reason?: string };
      expect(out.changed).toBe(false);
      expect(out.reason).toBe("NO_CHANGE");
    }
  });

  it("populates changeReview with diff statistics and applies change upon user approval", async () => {
    const filePath = path.join(tmpDir, "button.tsx");
    await fs.writeFile(
      filePath,
      "export function Button() {\n  return <button>Click</button>;\n}\n",
      "utf-8"
    );

    let capturedRequest: ApprovalRequest | undefined;
    const resolver: ApprovalResolver = {
      resolve: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        capturedRequest = req;
        return { approved: true };
      }
    };

    let callCount = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "button.tsx",
              oldText: "<button>Click</button>",
              newText: "<button disabled={false}>Click</button>"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Button updated." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Update button", cwd: tmpDir })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.changeReview).toBeDefined();
    const review = capturedRequest?.changeReview as ChangeReview;
    expect(review.files.length).toBe(1);
    expect(review.files[0].path).toBe("button.tsx");
    expect(review.files[0].operation).toBe("modified");
    expect(review.totalAddedLines).toBeGreaterThan(0);
    expect(review.totalRemovedLines).toBeGreaterThan(0);

    const updatedContent = await fs.readFile(filePath, "utf-8");
    expect(updatedContent).toContain("disabled={false}");
  });

  it("prevents file mutation when user denies approval", async () => {
    const filePath = path.join(tmpDir, "button.tsx");
    const initialContent = "export function Button() { return <button />; }\n";
    await fs.writeFile(filePath, initialContent, "utf-8");

    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => {
        return { approved: false, reason: "User declined this modification." };
      }
    };

    let callCount = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "button.tsx",
              oldText: "<button />",
              newText: "<button className='btn' />"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Understood." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Update button", cwd: tmpDir })) {
      events.push(ev);
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(false);
      expect(toolResultEvent.result.error?.code).toBe("PERMISSION_DENIED");
      expect(toolResultEvent.result.error?.message).toContain("User declined");
    }

    // Verify file remains unmodified
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(initialContent);
  });
});
