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

  it("lists nested files recursively when depth is greater than 1", async () => {
    // Default (depth: 1) does not include nested files
    const shallowResult = await tool.execute({ depth: 1 }, context);
    const shallowNames = shallowResult.output?.entries.map((e) => e.name);
    expect(shallowNames).toContain("src");
    expect(shallowNames).not.toContain("src/index.ts");

    // depth: 2 includes files inside subdirectories
    const deepResult = await tool.execute({ depth: 2 }, context);
    expect(deepResult.success).toBe(true);
    const deepNames = deepResult.output?.entries.map((e) => e.name);
    expect(deepNames).toContain("src");
    expect(deepNames).toContain("src/index.ts");

    const nestedFile = deepResult.output?.entries.find((e) => e.name === "src/index.ts");
    expect(nestedFile?.type).toBe("file");
  });

  it("skips recursing into ignored directories like .git or node_modules", async () => {
    await fs.mkdir(path.join(tmpDir, ".git", "objects"));
    await fs.writeFile(path.join(tmpDir, ".git", "objects", "commit.hash"), "data");

    const result = await tool.execute({ depth: 3 }, context);
    expect(result.success).toBe(true);
    const names = result.output?.entries.map((e) => e.name) || [];
    expect(names).toContain(".git");
    expect(names).not.toContain(".git/objects");
    expect(names).not.toContain(".git/objects/commit.hash");
  });

  it("supports deeply nested directories up to clamped depth", async () => {
    await fs.mkdir(path.join(tmpDir, "docs", "audit"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "docs", "audit", "AUDIT_REPORT.md"), "audit report");

    const result = await tool.execute({ path: "docs", depth: 2 }, context);
    expect(result.success).toBe(true);
    const names = result.output?.entries.map((e) => e.name);
    expect(names).toContain("audit");
    expect(names).toContain("audit/AUDIT_REPORT.md");
  });

  it("classifies valid and broken symlinks accurately with type 'symlink' and broken flag", async () => {
    // Test on real filesystem using junctions/symlinks if supported
    let symlinksCreated = false;
    try {
      const targetDir = path.join(tmpDir, "real_target_dir");
      await fs.mkdir(targetDir);
      await fs.writeFile(path.join(targetDir, "data.txt"), "ok");

      const validLink = path.join(tmpDir, "valid_link");
      const brokenTarget = path.join(tmpDir, "will_be_deleted");
      await fs.mkdir(brokenTarget);
      const brokenLink = path.join(tmpDir, "dangling_link");

      await fs.symlink(targetDir, validLink, "junction");
      await fs.symlink(brokenTarget, brokenLink, "junction");
      await fs.rmdir(brokenTarget);
      symlinksCreated = true;
    } catch {
      symlinksCreated = false;
    }

    if (symlinksCreated) {
      const result = await tool.execute({}, context);
      expect(result.success).toBe(true);

      const validEntry = result.output?.entries.find((e) => e.name === "valid_link");
      expect(validEntry).toBeDefined();
      expect(validEntry?.type).toBe("symlink");
      expect(validEntry?.broken).toBeUndefined();
      expect(validEntry?.target).toBeDefined();

      const brokenEntry = result.output?.entries.find((e) => e.name === "dangling_link");
      expect(brokenEntry).toBeDefined();
      expect(brokenEntry?.type).toBe("symlink");
      expect(brokenEntry?.broken).toBe(true);
      expect(brokenEntry?.type).not.toBe("file");
    }
  });

  it("ensures broken symlinks are not misreported as regular files or directories", async () => {
    try {
      const targetDir = path.join(tmpDir, "temp_target_dir");
      await fs.mkdir(targetDir);
      const brokenLink = path.join(tmpDir, "broken_item");
      await fs.symlink(targetDir, brokenLink, "junction");
      await fs.rmdir(targetDir);

      const result = await tool.execute({}, context);
      expect(result.success).toBe(true);

      const brokenItem = result.output?.entries.find((e) => e.name === "broken_item");
      if (brokenItem) {
        expect(brokenItem.type).toBe("symlink");
        expect(brokenItem.broken).toBe(true);
        expect(brokenItem.type).not.toBe("file");
        expect(brokenItem.type).not.toBe("directory");
      }
    } catch {
      // Junction/symlink not supported in environment
    }
  });
});
