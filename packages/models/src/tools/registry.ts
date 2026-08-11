import type { Tool, ToolRegistry } from "./types.js";

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
