import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { writeAtomic } from "./atomicWriter.js";

describe("writeAtomic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-atomic-writer-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("writes new file atomically with correct content", async () => {
    const targetFile = path.join(tmpDir, "newfile.txt");
    await writeAtomic(targetFile, "Hello World");

    const content = await fs.readFile(targetFile, "utf-8");
    expect(content).toBe("Hello World");
  });

  it("overwrites existing file atomically", async () => {
    const targetFile = path.join(tmpDir, "existing.txt");
    await fs.writeFile(targetFile, "Original Content", "utf-8");

    await writeAtomic(targetFile, "Updated Content");

    const content = await fs.readFile(targetFile, "utf-8");
    expect(content).toBe("Updated Content");
  });

  it("throws CANCELLED and does not touch file if signal is already aborted", async () => {
    const targetFile = path.join(tmpDir, "cancelled.txt");
    await fs.writeFile(targetFile, "Initial Content", "utf-8");

    const controller = new AbortController();
    controller.abort();

    await expect(writeAtomic(targetFile, "Should Not Write", controller.signal)).rejects.toThrow(
      "CANCELLED"
    );

    const content = await fs.readFile(targetFile, "utf-8");
    expect(content).toBe("Initial Content");
  });

  it("handles long filenames without ENAMETOOLONG errors", async () => {
    const longName = `${"a".repeat(200)}.txt`;
    const targetFile = path.join(tmpDir, longName);

    await writeAtomic(targetFile, "Long Filename Content");

    const content = await fs.readFile(targetFile, "utf-8");
    expect(content).toBe("Long Filename Content");
  });

  it("falls back to copy when rename fails with EPERM, EBUSY, or EXDEV", async () => {
    const targetFile = path.join(tmpDir, "fallback.txt");
    await fs.writeFile(targetFile, "Old Content", "utf-8");

    let renameCalled = false;
    const fakeRename = async () => {
      renameCalled = true;
      const err = new Error("Cross-device link or locked") as NodeJS.ErrnoException;
      err.code = "EXDEV";
      throw err;
    };

    await writeAtomic(targetFile, "New Content via Fallback", {
      renameFn: fakeRename
    });

    expect(renameCalled).toBe(true);
    const content = await fs.readFile(targetFile, "utf-8");
    expect(content).toBe("New Content via Fallback");
  });

  it("prevents file zeroing/truncation when copy fallback fails with ENOSPC", async () => {
    const targetFile = path.join(tmpDir, "critical_code.ts");
    const originalContent = "export const importantLogic = () => { return 42; };";
    await fs.writeFile(targetFile, originalContent, "utf-8");

    // Simulate rename failing (e.g. Windows file lock or EXDEV)
    const fakeRename = async () => {
      const err = new Error("Access denied on rename") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    };

    // Simulate copyFile failing on destination write with ENOSPC (disk full)
    const fakeCopy = async (src: string, dest: string) => {
      // If copying to backup, allow backup creation
      if (dest.includes(".bak.")) {
        await fs.copyFile(src, dest);
        return;
      }
      // When copying temp file into targetPath, simulate disk full truncation failure
      if (dest === targetFile) {
        // Many OS copy routines truncate destination first before failing on disk write
        await fs.writeFile(targetFile, "", "utf-8"); // zero the file
        const enospc = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        enospc.code = "ENOSPC";
        throw enospc;
      }
      await fs.copyFile(src, dest);
    };

    await expect(
      writeAtomic(targetFile, "New Data That Exceeds Disk", {
        renameFn: fakeRename,
        copyFn: fakeCopy
      })
    ).rejects.toThrow("ENOSPC");

    // CRITICAL INVARIANT: The original file must NOT be left at 0 bytes or lost!
    const restoredContent = await fs.readFile(targetFile, "utf-8");
    expect(restoredContent).toBe(originalContent);
  });
});
