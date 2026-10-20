import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool, ToolContext, ToolRegistry, ToolResult } from "@fecode/models";
import { isMcpHttpServerConfig, type McpServerConfig } from "./types.js";

const FECODE_CLIENT_VERSION = "1.1.2";

function sanitizeNamePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildTransport(config: McpServerConfig): Transport {
  if (isMcpHttpServerConfig(config)) {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined
    });
  }

  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd
  });
}

type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function toToolResult(mcpResult: McpCallToolResult): ToolResult {
  const isError = "isError" in mcpResult && mcpResult.isError === true;
  const content = "content" in mcpResult ? mcpResult.content : undefined;

  const text = Array.isArray(content)
    ? content
        .map((block) => {
          if (block && typeof block === "object" && "type" in block) {
            if (block.type === "text") {
              return (block as { text: string }).text;
            }
            if (block.type === "resource" && "resource" in block) {
              const resource = (block as {
                resource: { text?: string; uri: string };
              }).resource;
              return resource.text ?? `[resource: ${resource.uri}]`;
            }
            return `[${block.type} content]`;
          }
          return String(block);
        })
        .join("\n")
    : JSON.stringify(mcpResult);

  if (isError) {
    return {
      success: false,
      error: { message: text || "MCP tool reported an error.", code: "MCP_TOOL_ERROR" }
    };
  }

  return { success: true, output: text };
}

export interface ConnectedMcpServer {
  client: Client;
  tools: Tool[];
}

export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig
): Promise<ConnectedMcpServer> {
  const client = new Client({ name: "fecode", version: FECODE_CLIENT_VERSION });
  const transport = buildTransport(config);
  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();
  const safeServerName = sanitizeNamePart(serverName);

  const tools: Tool[] = mcpTools.map((mcpTool) => ({
    name: `mcp__${safeServerName}__${sanitizeNamePart(mcpTool.name)}`,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    inputSchema: mcpTool.inputSchema,
    permissionCategory: "network",
    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: (input as Record<string, unknown>) ?? {}
        });
        return toToolResult(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: {
            message: `MCP tool '${mcpTool.name}' on server '${serverName}' failed: ${message}`,
            code: "MCP_CALL_FAILED"
          }
        };
      }
    }
  }));

  return { client, tools };
}

export interface McpRegistrationResult {
  connected: string[];
  failed: { name: string; error: string }[];
  toolCounts: Record<string, number>;
}

export async function registerMcpServers(
  registry: ToolRegistry,
  servers: Record<string, McpServerConfig> | undefined
): Promise<McpRegistrationResult> {
  const result: McpRegistrationResult = { connected: [], failed: [], toolCounts: {} };
  if (!servers) {
    return result;
  }

  await Promise.all(
    Object.entries(servers).map(async ([name, config]) => {
      try {
        const { tools } = await connectMcpServer(name, config);
        for (const tool of tools) {
          registry.register(tool);
        }
        result.connected.push(name);
        result.toolCounts[name] = tools.length;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ name, error: message });
      }
    })
  );

  return result;
}
