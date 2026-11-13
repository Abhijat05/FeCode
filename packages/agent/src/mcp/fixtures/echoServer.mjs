// Standalone real MCP server used only by integration tests. Spawned as a
// child process over stdio by connectMcpServer() — not part of any build output.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture-echo-server", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes back the given message",
    inputSchema: { message: z.string() }
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `echo: ${message}` }]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
