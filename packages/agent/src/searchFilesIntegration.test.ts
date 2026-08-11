import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import type { AgentEvent } from "./index.js";

class MockSearchFilesModelProvider implements ModelProvider {
  public id = "mock-search-files-provider";
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

describe("search_files Agent Integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-agent-search-test-"));
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.mkdir(path.join(tmpDir, "src", "pages"));
    await fs.writeFile(
      path.join(tmpDir, "src", "pages", "Dashboard.tsx"),
      "export function Dashboard() { return <div>Dashboard</div>; }\n"
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes search_files tool call and feeds match results back to model for final response", async () => {
    const provider = new MockSearchFilesModelProvider();
    const registry = createDefaultToolRegistry();

    let turnCount = 0;
    const requests: ModelRequest[] = [];

    provider.generateFn = async function* (request: ModelRequest) {
      turnCount++;
      requests.push(request);

      if (turnCount === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-search-1",
            name: "search_files",
            arguments: { query: "Dashboard" }
          }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "The Dashboard component is defined in src/pages/Dashboard.tsx at line 1."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "Where is the Dashboard component defined?",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();

    if (toolResultEvent && toolResultEvent.type === "tool_result") {
      expect(toolResultEvent.result.success).toBe(true);
      const matches = (toolResultEvent.result.output as { matches: Array<{ path: string; line: number }> }).matches;
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].path).toContain("Dashboard.tsx");
      expect(matches[0].line).toBe(1);
    }

    const textEvent = events.find((e) => e.type === "text");
    expect(textEvent).toBeDefined();
    if (textEvent && textEvent.type === "text") {
      expect(textEvent.content).toContain("src/pages/Dashboard.tsx");
    }

    expect(requests).toHaveLength(2);
  });
});
