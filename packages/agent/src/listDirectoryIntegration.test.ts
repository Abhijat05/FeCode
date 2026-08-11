import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import { AgentRuntime } from "./runtime.js";
import { createDefaultToolRegistry } from "./tools/defaultRegistry.js";
import type { AgentEvent } from "./index.js";

class MockDirectoryModelProvider implements ModelProvider {
  public id = "mock-dir-provider";
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

describe("list_directory Agent Integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-agent-dir-test-"));
    await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(path.join(tmpDir, "src", "main.ts"), "console.log()");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes list_directory tool call and feeds structured result back to model", async () => {
    const provider = new MockDirectoryModelProvider();
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
            id: "call-dir-1",
            name: "list_directory",
            arguments: {}
          }
        };
        yield { type: "completed" };
      } else {
        yield {
          type: "text_delta",
          content: "The project contains package.json and src."
        };
        yield { type: "completed" };
      }
    };

    const runtime = new AgentRuntime(provider, { registry });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run({
      message: "What files are in this project?",
      cwd: tmpDir
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call-dir-1",
          name: "list_directory",
          arguments: {}
        }
      },
      {
        type: "tool_result",
        result: {
          success: true,
          output: {
            path: ".",
            entries: [
              { name: "package.json", type: "file" },
              { name: "src", type: "directory" }
            ],
            truncated: undefined,
            totalCount: undefined
          }
        },
        callId: "call-dir-1"
      },
      {
        type: "text",
        content: "The project contains package.json and src."
      },
      { type: "done" }
    ]);

    expect(requests).toHaveLength(2);
  });
});
