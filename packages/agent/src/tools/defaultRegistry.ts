import { DefaultToolRegistry, type ToolRegistry } from "@fecode/models";
import { ListDirectoryTool } from "./listDirectory.js";
import { ReadFileTool } from "./readFile.js";
import { SearchFilesTool } from "./searchFiles.js";
import { WriteFileTool } from "./writeFile.js";
import { EditFileTool } from "./editFile.js";
import { ExecuteCommandTool } from "../commands/executeCommandTool.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new DefaultToolRegistry();
  registry.register(new ListDirectoryTool());
  registry.register(new ReadFileTool());
  registry.register(new SearchFilesTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new ExecuteCommandTool());
  return registry;
}
