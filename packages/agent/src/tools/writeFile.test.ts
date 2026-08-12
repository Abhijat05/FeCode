import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { WriteFileTool } from "./writeFile.js";
import type { ToolContext } from "@fecode/models";

describe("WriteFileTool", () => {
  let tmpDir: string;
  let tool: WriteFileTool;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-write-file-test-"));
    tool = new WriteFileTool();
    context = { cwd: tmpDir, signal: controller.signal };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("declares permissionCategory = 'write'", () => {
    expect(tool.name).toBe("write_file");
    expect(tool.permissionCategory).toBe("write");
  });

  it("creates a new file and parent directories, returning created=true", async () => {
    const target = "src/components/ui/Button.tsx";
    const content = "export function Button() { return <button>Click</button>; }\n";

    const result = await tool.execute({ path: target, content }, context);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      path: path.normalize(target),
      created: true,
      overwritten: false,
      bytesWritten: Buffer.byteLength(content, "utf-8")
    });

    const writtenOnDisk = await fs.readFile(path.join(tmpDir, target), "utf-8");
    expect(writtenOnDisk).toBe(content);
  });

  it("overwrites an existing file, returning overwritten=true", async () => {
    const fileRel = "existing.txt";
    await fs.writeFile(path.join(tmpDir, fileRel), "Initial text");

    const newContent = "Updated text";
    const result = await tool.execute({ path: fileRel, content: newContent }, context);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      path: "existing.txt",
      created: false,
      overwritten: true,
      bytesWritten: Buffer.byteLength(newContent, "utf-8")
    });

    const writtenOnDisk = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(writtenOnDisk).toBe(newContent);
  });

  it("rejects path traversal attempts outside project root with PATH_OUT_OF_BOUNDS", async () => {
    const result = await tool.execute({ path: "../../secret.txt", content: "data" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("rejects missing path or content arguments with INVALID_ARGUMENT", async () => {
    const resultNoPath = await tool.execute({ path: "", content: "hi" }, context);
    expect(resultNoPath.success).toBe(false);
    expect(resultNoPath.error?.code).toBe("INVALID_ARGUMENT");

    const resultNoContent = await tool.execute({ path: "test.txt", content: null as unknown as string }, context);
    expect(resultNoContent.success).toBe(false);
    expect(resultNoContent.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects oversized content with FILE_TOO_LARGE without modifying existing file on disk", async () => {
    const fileRel = "bounded.txt";
    const initialText = "Original Content";
    await fs.writeFile(path.join(tmpDir, fileRel), initialText);

    const limitedTool = new WriteFileTool({ maxBytes: 20 });
    const longContent = "This content is definitely longer than 20 bytes limit.";

    const result = await limitedTool.execute({ path: fileRel, content: longContent }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("FILE_TOO_LARGE");

    // Verify file on disk was NOT mutated
    const diskContent = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(diskContent).toBe(initialText);
  });

  it("preserves exact UTF-8, unicode characters, and newlines without alteration", async () => {
    const fileRel = "unicode.txt";
    const specialContent = "🚀 Hello FeCode 开发者!\r\nLine 2\nLine 3";

    const result = await tool.execute({ path: fileRel, content: specialContent }, context);
    expect(result.success).toBe(true);

    const diskContent = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(diskContent).toBe(specialContent);
  });
});
