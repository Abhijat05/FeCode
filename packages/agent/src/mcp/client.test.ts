import { describe, it, expect, vi, beforeEach } from "vitest";
import { DefaultToolRegistry } from "@fecode/models";

const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool
    };
  })
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function MockStdioClientTransport(opts: unknown) {
    return { kind: "stdio", opts };
  })
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi
    .fn()
    .mockImplementation(function MockStreamableHTTPClientTransport(url: unknown, opts: unknown) {
      return { kind: "http", url, opts };
    })
}));

import { connectMcpServer, registerMcpServers } from "./client.js";

describe("connectMcpServer", () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockListTools.mockReset();
    mockCallTool.mockReset();
  });

  it("connects via stdio transport for a command-based config and wraps namespaced tools", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        { name: "read_thing", description: "Reads a thing", inputSchema: { type: "object" } }
      ]
    });

    const { tools } = await connectMcpServer("my-server", { command: "my-mcp-server", args: ["--flag"] });

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp__my-server__read_thing");
    expect(tools[0].description).toContain("[MCP:my-server]");
    expect(tools[0].description).toContain("Reads a thing");
    expect(tools[0].inputSchema).toEqual({ type: "object" });
    expect(tools[0].permissionCategory).toBe("network");
  });

  it("connects via streamable HTTP transport for a url-based config", async () => {
    mockListTools.mockResolvedValue({ tools: [] });

    await connectMcpServer("remote", { url: "https://example.com/mcp", headers: { Authorization: "Bearer xyz" } });

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("sanitizes server and tool names with unsafe characters for the wire-level tool name", async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: "do thing!", description: "d", inputSchema: {} }]
    });

    const { tools } = await connectMcpServer("my server!", { command: "x" });
    expect(tools[0].name).toBe("mcp__my_server___do_thing_");
  });

  it("execute() calls client.callTool with the tool's original name and the given arguments", async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: "add", description: "adds numbers", inputSchema: { type: "object" } }]
    });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "3" }], isError: false });

    const { tools } = await connectMcpServer("calc", { command: "calc-server" });
    const result = await tools[0].execute({ a: 1, b: 2 }, { cwd: "/tmp", signal: new AbortController().signal });

    expect(mockCallTool).toHaveBeenCalledWith({ name: "add", arguments: { a: 1, b: 2 } });
    expect(result.success).toBe(true);
    expect(result.output).toBe("3");
  });

  it("execute() maps an MCP isError result into a failed ToolResult", async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: "fail", description: "fails", inputSchema: {} }]
    });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "boom" }], isError: true });

    const { tools } = await connectMcpServer("srv", { command: "x" });
    const result = await tools[0].execute({}, { cwd: "/tmp", signal: new AbortController().signal });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("boom");
    expect(result.error?.code).toBe("MCP_TOOL_ERROR");
  });

  it("execute() catches a thrown error from callTool and returns a failed ToolResult without throwing", async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: "crash", description: "crashes", inputSchema: {} }]
    });
    mockCallTool.mockRejectedValue(new Error("connection lost"));

    const { tools } = await connectMcpServer("srv", { command: "x" });
    const result = await tools[0].execute({}, { cwd: "/tmp", signal: new AbortController().signal });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("MCP_CALL_FAILED");
    expect(result.error?.message).toContain("connection lost");
  });
});

describe("registerMcpServers", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockListTools.mockReset();
    mockCallTool.mockReset();
  });

  it("returns empty result when no servers are configured", async () => {
    const registry = new DefaultToolRegistry();
    const result = await registerMcpServers(registry, undefined);
    expect(result).toEqual({ connected: [], failed: [], toolCounts: {} });
  });

  it("registers tools from a healthy server and reports a failing server without throwing", async () => {
    mockConnect.mockImplementation(async (transport: { opts?: { command?: string } }) => {
      if (transport?.opts?.command === "broken-server") {
        throw new Error("ECONNREFUSED");
      }
      return undefined;
    });
    mockListTools.mockResolvedValue({
      tools: [{ name: "ping", description: "pings", inputSchema: {} }]
    });

    const registry = new DefaultToolRegistry();
    const result = await registerMcpServers(registry, {
      healthy: { command: "healthy-server" },
      broken: { command: "broken-server" }
    });

    expect(result.connected).toContain("healthy");
    expect(result.failed.some((f) => f.name === "broken")).toBe(true);
    expect(result.failed.find((f) => f.name === "broken")?.error).toContain("ECONNREFUSED");

    const registeredNames = registry.list().map((t) => t.name);
    expect(registeredNames).toContain("mcp__healthy__ping");
  });
});
