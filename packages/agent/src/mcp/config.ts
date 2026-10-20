import * as fs from "fs";
import * as path from "path";
import type { McpConfig } from "./types.js";

export function findMcpConfigFile(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, ".fecode", "mcp.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return undefined;
}

export function loadMcpConfig(cwd: string): McpConfig {
  const configPath = findMcpConfigFile(cwd);
  if (!configPath) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(
        `FeCode: MCP config at ${configPath} is not a JSON object. Ignoring MCP configuration.`
      );
      return {};
    }
    return parsed as McpConfig;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `FeCode: failed to parse MCP config at ${configPath}: ${message}. Ignoring MCP configuration.`
    );
    return {};
  }
}
