import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import type { AgentEvent } from "./index.js";

class MockReadFileModelProvider implements ModelProvider {
  public id = "mock-read-file-provider";
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

describe("read_file Agent Integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-agent-read-test-"));
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(
      path.join(tmpDir, "src", "App.tsx"),
      "export const App = () => <h1>Hello FeCode</h1>;\n"
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes read_file tool call and feeds file contents back to model for final text response", async () => {
    const provider = new MockReadFileModelProvider();
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
            id: "call-read-1",
            name: "read_file",
            arguments: { path: "src/App.tsx" }
          }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "The App component renders an h1 with Hello FeCode."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "Read src/App.tsx and explain what it does.",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call-read-1",
          name: "read_file",
          arguments: { path: "src/App.tsx" }
        }
      },
      {
        type: "tool_result",
        result: {
          success: true,
          output: {
            path: "src" + path.sep + "App.tsx",
            content: "export const App = () => <h1>Hello FeCode</h1>;\n",
            startLine: 1,
            endLine: 2,
            truncated: false
          }
        },
        callId: "call-read-1"
      },
      {
        type: "text",
        content: "The App component renders an h1 with Hello FeCode."
      },
      { type: "done" }
    ]);

    expect(requests).toHaveLength(2);
  });
});
