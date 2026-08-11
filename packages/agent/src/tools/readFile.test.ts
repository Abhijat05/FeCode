import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ReadFileTool } from "./readFile.js";
import type { ToolContext } from "@fecode/models";

describe("ReadFileTool", () => {
  let tmpDir: string;
  let tool: ReadFileTool;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-read-file-test-"));
    tool = new ReadFileTool();
    context = { cwd: tmpDir, signal: controller.signal };

    // Setup sample files
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "Hello\nWorld\nFrom FeCode");
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(path.join(tmpDir, "src", "App.tsx"), "import React from 'react';\nexport const App = () => <div />;\n");
    await fs.writeFile(path.join(tmpDir, ".env"), "PORT=3000\nNODE_ENV=test");
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules\ndist");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads a normal text file returning path, content, line range, and truncated status", async () => {
    const result = await tool.execute({ path: "hello.txt" }, context);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      path: "hello.txt",
      content: "Hello\nWorld\nFrom FeCode",
      startLine: 1,
      endLine: 3,
      truncated: false
    });
  });

  it("reads nested files with relative path", async () => {
    const result = await tool.execute({ path: "src/App.tsx" }, context);
    expect(result.success).toBe(true);
    expect(result.output?.startLine).toBe(1);
    expect(result.output?.endLine).toBe(3);
    expect(result.output?.content).toContain("import React");
  });

  it("reads explicitly requested hidden text files like .env and .gitignore", async () => {
    const resultEnv = await tool.execute({ path: ".env" }, context);
    expect(resultEnv.success).toBe(true);
    expect(resultEnv.output?.content).toContain("PORT=3000");

    const resultGit = await tool.execute({ path: ".gitignore" }, context);
    expect(resultGit.success).toBe(true);
    expect(resultGit.output?.content).toContain("node_modules");
  });

  it("rejects path traversal attempts outside project root", async () => {
    const result = await tool.execute({ path: "../../secret.txt" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
    expect(result.error?.message).toContain("traversal outside project root");
  });

  it("rejects absolute paths pointing outside project root", async () => {
    const outsideFile = path.resolve(tmpDir, "..", "other.txt");
    const result = await tool.execute({ path: outsideFile }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("returns structured error NOT_FOUND when file does not exist", async () => {
    const result = await tool.execute({ path: "nonexistent.ts" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("File does not exist");
  });

  it("returns structured error NOT_A_FILE when path is a directory", async () => {
    const result = await tool.execute({ path: "src" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_A_FILE");
    expect(result.error?.message).toContain("Path is a directory");
  });

  it("rejects binary files based on file extension (.png, .zip, .pdf)", async () => {
    const pngPath = path.join(tmpDir, "image.png");
    await fs.writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await tool.execute({ path: "image.png" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("BINARY_FILE");
    expect(result.error?.message).toContain("binary");
  });

  it("rejects binary files based on null byte content inspection", async () => {
    const binPath = path.join(tmpDir, "unknown.data");
    await fs.writeFile(binPath, Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]));

    const result = await tool.execute({ path: "unknown.data" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("BINARY_FILE");
    expect(result.error?.message).toContain("binary");
  });

  it("truncates large files exceeding maxBytes limit and sets truncated: true", async () => {
    const limitedTool = new ReadFileTool({ maxBytes: 20 });
    const result = await limitedTool.execute({ path: "hello.txt" }, context);

    expect(result.success).toBe(true);
    expect(result.output?.truncated).toBe(true);
    expect(result.output?.content.length).toBeLessThanOrEqual(20);
    expect(result.output?.startLine).toBe(1);
    expect(result.output?.endLine).toBeGreaterThanOrEqual(1);
  });
});
