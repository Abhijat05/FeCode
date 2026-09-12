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

  it("supports reading a specific line range using startLine and endLine", async () => {
    const multiLineContent = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(tmpDir, "multiline.txt"), multiLineContent);

    const result = await tool.execute({ path: "multiline.txt", startLine: 10, endLine: 15 }, context);
    expect(result.success).toBe(true);
    expect(result.output?.startLine).toBe(10);
    expect(result.output?.endLine).toBe(15);
    expect(result.output?.content).toBe("Line 10\nLine 11\nLine 12\nLine 13\nLine 14\nLine 15");
    expect(result.output?.truncated).toBe(true);
  });

  it("truncates files exceeding maxDefaultLines when no line range is requested", async () => {
    const multiLineContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(tmpDir, "lines.txt"), multiLineContent);

    const lineLimitedTool = new ReadFileTool({ maxDefaultLines: 5 });
    const result = await lineLimitedTool.execute({ path: "lines.txt" }, context);
    expect(result.success).toBe(true);
    expect(result.output?.truncated).toBe(true);
    expect(result.output?.startLine).toBe(1);
    expect(result.output?.endLine).toBe(5);
    expect(result.output?.content).toContain("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    expect(result.output?.content).toContain("File has 20 lines. Showing lines 1-5");
  });

  it("successfully reads line range from a file that exceeds maxBytes limit", async () => {
    // Generate a file with 100 lines (~1500 bytes)
    const longContent = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(15)}`).join("\n");
    await fs.writeFile(path.join(tmpDir, "huge.txt"), longContent);

    // Limit maxBytes to 200 bytes (which only covers first ~12 lines)
    const byteLimitedTool = new ReadFileTool({ maxBytes: 200 });

    // Request lines 50 to 55 (well beyond the first 200 bytes)
    const result = await byteLimitedTool.execute({ path: "huge.txt", startLine: 50, endLine: 55 }, context);
    expect(result.success).toBe(true);
    expect(result.output?.startLine).toBe(50);
    expect(result.output?.endLine).toBe(55);
    expect(result.output?.content).toBe(
      Array.from({ length: 6 }, (_, i) => `Line ${50 + i}: ${"x".repeat(15)}`).join("\n")
    );
  });
});
