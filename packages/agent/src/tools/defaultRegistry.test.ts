import { describe, it, expect } from "vitest";
import { createDefaultToolRegistry } from "./defaultRegistry.js";

describe("createDefaultToolRegistry", () => {
  it("creates a tool registry pre-populated with list_directory, read_file, and search_files tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("list_directory")).toBeDefined();
    expect(registry.get("read_file")).toBeDefined();
    expect(registry.get("search_files")).toBeDefined();

    const names = registry.list().map((t) => t.name);
    expect(names).toContain("list_directory");
    expect(names).toContain("read_file");
    expect(names).toContain("search_files");
  });
});
