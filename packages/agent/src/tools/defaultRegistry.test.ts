import { describe, it, expect } from "vitest";
import { createDefaultToolRegistry } from "./defaultRegistry.js";

describe("createDefaultToolRegistry", () => {
  it("creates a tool registry pre-populated with list_directory, read_file, search_files, write_file, edit_file, and execute_command tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("list_directory")).toBeDefined();
    expect(registry.get("read_file")).toBeDefined();
    expect(registry.get("search_files")).toBeDefined();
    expect(registry.get("write_file")).toBeDefined();
    expect(registry.get("edit_file")).toBeDefined();
    expect(registry.get("execute_command")).toBeDefined();
    expect(registry.get("execute_command")?.permissionCategory).toBe("execute");

    const names = registry.list().map((t) => t.name);
    expect(names).toEqual([
      "list_directory",
      "read_file",
      "search_files",
      "write_file",
      "edit_file",
      "execute_command"
    ]);
  });
});
