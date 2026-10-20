import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { DefaultToolRegistry } from "@fecode/models";
import type {
  ModelProvider,
  ModelRequest,
  ModelEvent,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalResolver
} from "@fecode/models";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import { registerMcpServers } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER_PATH = path.join(__dirname, "fixtures", "echoServer.mjs");

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 8192
  };

  private turn = 0;

  async *generate(
    _request: ModelRequest,
    _signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    this.turn += 1;
    if (this.turn === 1) {
      yield {
        type: "tool_call",
        call: {
          id: "call-1",
          name: "mcp__fixture__echo",
          arguments: { message: "hi from the model" }
        }
      };
      yield { type: "completed" };
    } else {
      yield { type: "text_delta", content: "Done." };
      yield { type: "completed" };
    }
  }
}

describe("MCP tools in a real AgentRuntime loop (end-to-end, no mocked SDK)", () => {
  it(
    "connects a real spawned MCP server, requires approval via the real DefaultPermissionManager (no overrides), and executes the tool through the normal dispatch path",
    async () => {
      const registry = new DefaultToolRegistry();
      const registration = await registerMcpServers(registry, {
        fixture: { command: "node", args: [ECHO_SERVER_PATH] }
      });

      expect(registration.failed).toEqual([]);
      expect(registration.connected).toEqual(["fixture"]);

      const approvalRequests: ApprovalRequest[] = [];
      const approvalResolver: ApprovalResolver = {
        resolve: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
          approvalRequests.push(req);
          return { approved: true };
        }
      };

      // Deliberately NOT overriding permissionManager: AgentRuntime falls back to the
      // real DefaultPermissionManager/DefaultPermissionPolicy used in production, so
      // this exercises the actual approval-gating logic for an MCP ("network") tool.
      const runtime = new AgentRuntime(new MockModelProvider(), {
        registry,
        approvalResolver
      });

      const events: AgentEvent[] = [];
      for await (const event of runtime.run({
        message: "Please echo something using the fixture MCP server.",
        cwd: "/test"
      })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "error")).toBe(false);

      expect(approvalRequests).toHaveLength(1);
      expect(approvalRequests[0].toolName).toBe("mcp__fixture__echo");
      expect(approvalRequests[0].category).toBe("network");

      const toolResultEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result"
      );
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent?.result.success).toBe(true);
      expect(toolResultEvent?.result.output).toBe("echo: hi from the model");

      expect(events.some((e) => e.type === "done")).toBe(true);
    },
    15000
  );
});
