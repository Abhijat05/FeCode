export interface McpStdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export function isMcpHttpServerConfig(
  config: McpServerConfig
): config is McpHttpServerConfig {
  return typeof (config as McpHttpServerConfig).url === "string";
}
