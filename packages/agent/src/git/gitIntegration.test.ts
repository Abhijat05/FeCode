import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createDefaultToolRegistry } from "../tools/defaultRegistry.js";
import { DefaultGitRepository, type GitCommandRunner } from "./gitRepository.js";
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

describe("Git Awareness & Change Attribution Runtime Integration — Phase 5F", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-git-test-"));
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "App.tsx"),
      "export const App = () => <div>App</div>;\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "components", "Header.tsx"),
      "export const Header = () => <h1>Old</h1>;\n",
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

  it("captures baseline snapshot, attributes FeCode edits, and preserves pre-existing modifications", async () => {
    let callPhase = 0;
    // Mock Git runner simulating pre-existing modification on src/App.tsx
    const mockGitRunner: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: `${tmpDir.replace(/\\/g, "/")}\n`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return { stdout: "feature/login\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "status") {
        callPhase++;
        if (callPhase === 1) {
          // Baseline: src/App.tsx is pre-existing modified
          return {
            stdout: "## feature/login\n M src/App.tsx\n",
            stderr: "",
            exitCode: 0
          };
        } else {
          // Post-task: src/App.tsx (pre-existing) + src/components/Header.tsx (FeCode)
          return {
            stdout: "## feature/login\n M src/App.tsx\n M src/components/Header.tsx\n",
            stderr: "",
            exitCode: 0
          };
        }
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const gitRepo = new DefaultGitRepository(mockGitRunner);
    const resolver: ApprovalResolver = {
      resolve: async (): Promise<ApprovalDecision> => ({ approved: true })
    };

    let step = 0;
    const provider = new MockProvider();
    provider.generateHandler = async function* () {
      step++;
      if (step === 1) {
        // FeCode modifies Header.tsx
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "edit_file",
            arguments: {
              path: "src/components/Header.tsx",
              oldText: "<h1>Old</h1>",
              newText: "<h1>Updated Header</h1>"
            }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Finished." };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, {
      approvalResolver: resolver,
      registry: createDefaultToolRegistry(),
      gitRepository: gitRepo
    });

    const events = [];
    for await (const ev of runtime.run({ message: "Update header", cwd: tmpDir })) {
      events.push(ev);
    }

    const summary = runtime.getCompletionSummary();
    expect(summary.status).toBe("completed");
    expect(summary.gitBranch).toBe("feature/login");
    expect(summary.gitAttribution).toBeDefined();

    const attr = summary.gitAttribution!;
    expect(attr.preExistingFiles).toEqual(["src/App.tsx"]);
    expect(attr.fecodeFiles).toEqual(["src/components/Header.tsx"]);
    expect(attr.preservedUserFiles).toEqual(["src/App.tsx"]);
    expect(attr.unattributedFiles).toEqual([]);

    // Check Task summary formatting
    const formatted = runtime.getCompletionSummary();
    const formattedText = SessionHistoryFormatter.formatTaskDetail(formatted, 1);
    expect(formattedText).toContain("Pre-existing before task:\n  1 file");
    expect(formattedText).toContain("FeCode-attributed:\n  1 file");
    expect(formattedText).toContain("Unattributed:\n  0 files");
  });
});
