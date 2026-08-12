import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { EditFileTool } from "./editFile.js";
import type { ToolContext } from "@fecode/models";

describe("EditFileTool", () => {
  let tmpDir: string;
  let tool: EditFileTool;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-edit-file-test-"));
    tool = new EditFileTool();
    context = { cwd: tmpDir, signal: controller.signal };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("declares permissionCategory = 'write'", () => {
    expect(tool.name).toBe("edit_file");
    expect(tool.permissionCategory).toBe("write");
  });

  it("replaces one exact occurrence of oldText with newText and generates diff", async () => {
    const fileRel = "src/Button.tsx";
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, fileRel),
      'import React from "react";\n\nexport const Button = () => <button className="old">Click</button>;\n'
    );

    const result = await tool.execute(
      {
        path: fileRel,
        oldText: 'className="old"',
        newText: 'className="rounded-lg px-4 py-2"'
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.output?.changed).toBe(true);
    expect(result.output?.replacements).toBe(1);
    expect(result.output?.diff).toContain('-export const Button = () => <button className="old">Click</button>;');
    expect(result.output?.diff).toContain('+export const Button = () => <button className="rounded-lg px-4 py-2">Click</button>;');

    const updatedOnDisk = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(updatedOnDisk).toContain('className="rounded-lg px-4 py-2"');
  });

  it("returns no-op result when oldText === newText without modifying file", async () => {
    const fileRel = "noop.txt";
    await fs.writeFile(path.join(tmpDir, fileRel), "same content");

    const result = await tool.execute(
      { path: fileRel, oldText: "same content", newText: "same content" },
      context
    );

    expect(result.success).toBe(true);
    expect(result.output?.changed).toBe(false);
    expect(result.output?.reason).toBe("NO_CHANGE");
  });

  it("returns EDIT_NOT_FOUND error when oldText is not present in file", async () => {
    const fileRel = "sample.txt";
    await fs.writeFile(path.join(tmpDir, fileRel), "hello world");

    const result = await tool.execute(
      { path: fileRel, oldText: "missing text", newText: "replacement" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("EDIT_NOT_FOUND");
  });

  it("returns AMBIGUOUS_EDIT error when oldText occurs multiple times in file", async () => {
    const fileRel = "multi.txt";
    await fs.writeFile(path.join(tmpDir, fileRel), "foo bar foo baz foo");

    const result = await tool.execute(
      { path: fileRel, oldText: "foo", newText: "bar" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("AMBIGUOUS_EDIT");
    expect(result.error?.message).toContain("multiple");
  });

  it("returns NOT_FOUND error when file does not exist", async () => {
    const result = await tool.execute(
      { path: "nonexistent.tsx", oldText: "old", newText: "new" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns PATH_OUT_OF_BOUNDS error for path traversal attempts", async () => {
    const result = await tool.execute(
      { path: "../../secret.txt", oldText: "old", newText: "new" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("returns FILE_TOO_LARGE when proposed content exceeds maxBytes limit", async () => {
    const fileRel = "large.txt";
    await fs.writeFile(path.join(tmpDir, fileRel), "0123456789");

    const limitedTool = new EditFileTool({ maxBytes: 15 });
    const result = await limitedTool.execute(
      { path: fileRel, oldText: "0123456789", newText: "0123456789_extra_long_content" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("FILE_TOO_LARGE");

    const diskContent = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(diskContent).toBe("0123456789");
  });

  it("preserves CRLF and LF newlines and unicode characters cleanly", async () => {
    const fileRel = "crlf.txt";
    const content = "line 1\r\n🚀 old line 2\r\nline 3";
    await fs.writeFile(path.join(tmpDir, fileRel), content);

    const result = await tool.execute(
      { path: fileRel, oldText: "🚀 old line 2", newText: "✨ new line 2" },
      context
    );

    expect(result.success).toBe(true);

    const diskContent = await fs.readFile(path.join(tmpDir, fileRel), "utf-8");
    expect(diskContent).toBe("line 1\r\n✨ new line 2\r\nline 3");
  });
});
