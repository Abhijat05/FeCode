import { describe, it, expect } from "vitest";
import { createDefaultToolRegistry } from "./defaultRegistry.js";

describe("createDefaultToolRegistry", () => {
  it("creates a tool registry pre-populated with list_directory and read_file tools", () => {
    const registry = createDefaultToolRegistry();
    const listDirTool = registry.get("list_directory");
    const readFileTool = registry.get("read_file");

    expect(listDirTool).toBeDefined();
    expect(listDirTool?.name).toBe("list_directory");

    expect(readFileTool).toBeDefined();
    expect(readFileTool?.name).toBe("read_file");

    const names = registry.list().map((t) => t.name);
    expect(names).toContain("list_directory");
    expect(names).toContain("read_file");
  });
});
