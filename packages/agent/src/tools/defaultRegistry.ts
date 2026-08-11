import { DefaultToolRegistry, type ToolRegistry } from "@fecode/models";
import { ListDirectoryTool } from "./listDirectory.js";
import { ReadFileTool } from "./readFile.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new DefaultToolRegistry();
  registry.register(new ListDirectoryTool());
  registry.register(new ReadFileTool());
  return registry;
}
