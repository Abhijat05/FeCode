import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultProductRuntime } from "./productRuntime.js";
import { AgentRuntime } from "../runtime.js";
import { DefaultToolRegistry, type ModelProvider } from "@fecode/models";
import { DefaultGitRepository } from "../git/gitRepository.js";

const DEFAULT_CAPS = {
  streaming: true,
  toolCalling: true,
  vision: false,
  maxContextTokens: 4096
};

describe("Phase 5AC — DefaultProductRuntime Facade Unit Tests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-prod-test-"));
    await fs.writeFile(path.join(tmpDir, "index.ts"), "console.log('hi');\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("submits task and yields stream of typed ProductEvents and UI state updates", async () => {
    const mockProvider: ModelProvider = {
      id: "mock-model",
      capabilities: DEFAULT_CAPS,
      async *generate() {
        yield { type: "text_delta", content: "Task processed successfully." };
        yield { type: "completed" };
      }
    };

    const registry = new DefaultToolRegistry();
    const runtime = new AgentRuntime(mockProvider, {
      registry
    });

    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      initialCwd: tmpDir
    });

    const events: import("./types.js").ProductEvent[] = [];
    for await (const ev of productRuntime.submitTask({
      message: "Test task",
      cwd: tmpDir
    })) {
      events.push(ev);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "run_status_changed")).toBe(true);
    expect(events.some((e) => e.type === "text_chunk")).toBe(true);
    expect(events.some((e) => e.type === "ui_state_changed")).toBe(true);

    const finalState = productRuntime.getUIState();
    expect(finalState.status).toBe("completed");
  });

  it("supports subscriber notifications on UIState mutations", async () => {
    const mockProvider: ModelProvider = {
      id: "mock-model",
      capabilities: DEFAULT_CAPS,
      async *generate() {
        yield { type: "text_delta", content: "Subscribed response." };
        yield { type: "completed" };
      }
    };

    const registry = new DefaultToolRegistry();
    const runtime = new AgentRuntime(mockProvider, {
      registry
    });

    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      initialCwd: tmpDir
    });

    const notifications: string[] = [];
    const unsubscribe = productRuntime.subscribe((state, event) => {
      if (event) {
        notifications.push(event.type);
      }
    });

    for await (const event of productRuntime.submitTask({
      message: "Subscription test",
      cwd: tmpDir
    })) {
      expect(event).toBeDefined();
    }

    unsubscribe();
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications).toContain("ui_state_changed");
  });

  it("returns immutable snapshots from state accessors", () => {
    const mockProvider: ModelProvider = {
      id: "mock-model",
      capabilities: DEFAULT_CAPS,
      async *generate() {
        yield { type: "text_delta", content: "ok" };
      }
    };

    const runtime = new AgentRuntime(mockProvider, {
      registry: new DefaultToolRegistry()
    });

    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      initialCwd: tmpDir
    });

    const s1 = productRuntime.getUIState();
    s1.skills.push("malicious_skill");

    const s2 = productRuntime.getUIState();
    expect(s2.skills).not.toContain("malicious_skill");
  });

  it("provides workspace snapshot querying", async () => {
    const mockRepo = new DefaultGitRepository(async (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { stdout: "true\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "branch") return { stdout: "feature/prod-shell\n", stderr: "", exitCode: 0 };
      if (args[0] === "status") return { stdout: "## feature/prod-shell\n M src/app.ts\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const runtime = new AgentRuntime(
      {
        id: "mock",
        capabilities: DEFAULT_CAPS,
        generate: async function* () {
          yield { type: "text_delta", content: "ok" };
        }
      },
      {
        registry: new DefaultToolRegistry(),
        gitRepository: mockRepo
      }
    );

    const productRuntime = new DefaultProductRuntime({
      agentRuntime: runtime,
      gitRepository: mockRepo,
      initialCwd: tmpDir
    });

    const ws = await productRuntime.getWorkspaceSnapshot();
    expect(ws.gitBranch).toBe("feature/prod-shell");
    expect(ws.isGitDirty).toBe(true);
    expect(ws.modifiedFiles).toContain("src/app.ts");
  });
});
