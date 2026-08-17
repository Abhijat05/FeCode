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
  ApprovalDecision
} from "@fecode/models";
import { SessionHistoryFormatter } from "../session/historyFormatter.js";

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

describe("Change Intelligence Runtime Integration — Phase 5E", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-ci-test-"));
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "src", "auth"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "components", "Header.tsx"),
      "export const Header = () => <h1>Old</h1>;\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "auth", "session.ts"),
      "export const token = 'none';\n",
      "utf-8"
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("builds ChangeSet with aggregated edits, areas, and verified commands", async () => {
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => ({ approved: true })
    };

    let step = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      step++;
      if (step === 1) {
        // Edit 1: Header.tsx
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/Header.tsx",
              oldText: "<h1>Old</h1>",
              newText: "<h1>New Header</h1>"
            }
          }
        };
        yield { type: "completed" };
      } else if (step === 2) {
        // Edit 2: Header.tsx again (aggregate test)
        yield {
          type: "tool_call",
          call: {
            id: "call-2",
            name: "edit_file",
            arguments: {
              path: "src/components/Header.tsx",
              oldText: "<h1>New Header</h1>",
              newText: "<h1>New Header Final</h1>"
            }
          }
        };
        yield { type: "completed" };
      } else if (step === 3) {
        // Edit 3: session.ts (auth area)
        yield {
          type: "tool_call",
          call: {
            id: "call-3",
            name: "edit_file",
            arguments: {
              path: "src/auth/session.ts",
              oldText: "token = 'none'",
              newText: "token = 'active'"
            }
          }
        };
        yield { type: "completed" };
      } else if (step === 4) {
        // Verification command
        yield {
          type: "tool_call",
          call: {
            id: "call-4",
            name: "execute_command",
            arguments: {
              command: "node -e \"process.exit(0)\""
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "All tasks completed." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry()
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Update header and auth", cwd: tmpDir })) {
      events.push(ev);
    }

    const summary = runtime.getCompletionSummary();
    expect(summary.status).toBe("completed");
    expect(summary.changeSet).toBeDefined();

    const cs = summary.changeSet!;
    expect(cs.stats.totalFiles).toBe(2);
    expect(cs.files.map((f) => f.path)).toEqual([
      "src/auth/session.ts",
      "src/components/Header.tsx"
    ]);

    // Header.tsx aggregated both edits
    const headerChange = cs.files.find((f) => f.path === "src/components/Header.tsx");
    expect(headerChange?.additions).toBeGreaterThanOrEqual(2);

    expect(cs.areas).toEqual(["authentication", "components"]);
    expect(cs.verification.attempted).toBe(true);
    expect(cs.verification.passed).toBe(true);

    // Verify SessionHistoryFormatter formats ChangeSet
    const historyText = SessionHistoryFormatter.formatHistory([summary]);
    expect(historyText).toContain("2 files");
    expect(historyText).toContain("authentication, components");

    const statusText = SessionHistoryFormatter.formatSessionStatus({
      sessionId: "test-sess",
      workingDirectory: tmpDir,
      provider: "mock",
      model: "mock-model",
      taskCount: 1,
      completedCount: 1,
      blockedCount: 0,
      currentStatus: "idle",
      lastChangeSet: cs
    });
    expect(statusText).toContain("Last change:\n  2 files");
  });
});
