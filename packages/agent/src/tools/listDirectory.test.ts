import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ListDirectoryTool } from "./listDirectory.js";
import type { ToolContext } from "@fecode/models";

describe("ListDirectoryTool", () => {
  let tmpDir: string;
  let tool: ListDirectoryTool;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-list-dir-test-"));
    tool = new ListDirectoryTool();
    context = { cwd: tmpDir, signal: controller.signal };

    // Setup dummy files and subdirectories
    await fs.writeFile(path.join(tmpDir, "fileA.txt"), "hello");
    await fs.writeFile(path.join(tmpDir, "fileB.js"), "console.log(1)");
    await fs.writeFile(path.join(tmpDir, ".env"), "SECRET=123");
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules");
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.mkdir(path.join(tmpDir, ".git"));
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "export {}");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists project root directory when path is omitted", async () => {
    const result = await tool.execute({}, context);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    const names = result.output?.entries.map((e) => e.name);
    expect(names).toContain("fileA.txt");
    expect(names).toContain("fileB.js");
    expect(names).toContain("src");
    expect(names).toContain(".env");
    expect(names).toContain(".gitignore");
    expect(names).toContain(".git");
  });

  it("lists nested directory using relative path", async () => {
    const result = await tool.execute({ path: "src" }, context);
    expect(result.success).toBe(true);
    expect(result.output?.entries).toEqual([
      { name: "index.ts", type: "file" }
    ]);
  });

  it("differentiates files and directories accurately", async () => {
    const result = await tool.execute({}, context);
    const srcEntry = result.output?.entries.find((e) => e.name === "src");
    const fileAEntry = result.output?.entries.find((e) => e.name === "fileA.txt");

    expect(srcEntry?.type).toBe("directory");
    expect(fileAEntry?.type).toBe("file");
  });

  it("returns entries in deterministic alphabetical order", async () => {
    const result = await tool.execute({}, context);
    const names = result.output?.entries.map((e) => e.name) || [];
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("rejects path traversal attempts outside project root", async () => {
    const result = await tool.execute({ path: "../../" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
    expect(result.error?.message).toContain("traversal outside project root");
  });

  it("rejects absolute paths outside project root", async () => {
    const outsidePath = path.resolve(tmpDir, "..", "outside-dir");
    const result = await tool.execute({ path: outsidePath }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("returns structured error when directory does not exist", async () => {
    const result = await tool.execute({ path: "nonexistent-folder" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("Directory does not exist");
  });

  it("returns structured error when path points to a file instead of a directory", async () => {
    const result = await tool.execute({ path: "fileA.txt" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_A_DIRECTORY");
    expect(result.error?.message).toContain("Path is a file");
  });

  it("truncates results when directory exceeds maxEntries limit", async () => {
    const limitedTool = new ListDirectoryTool({ maxEntries: 3 });
    const result = await limitedTool.execute({}, context);

    expect(result.success).toBe(true);
    expect(result.output?.entries).toHaveLength(3);
    expect(result.output?.truncated).toBe(true);
    expect(result.output?.totalCount).toBe(6);
  });
});
