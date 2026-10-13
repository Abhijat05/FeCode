import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  isReadOnlyStat,
  getWritePermissionDiagnostic
} from "./permissionDiagnostics.js";

describe("permissionDiagnostics", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-perm-test-"));
  });

  afterEach(async () => {
    try {
      // Restore write permissions before cleanup
      await fs.chmod(tmpDir, 0o777);
    } catch {
      // ignore
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("isReadOnlyStat", () => {
    it("returns true when write bits are not present", () => {
      expect(isReadOnlyStat({ mode: 0o444 })).toBe(true);
      expect(isReadOnlyStat({ mode: 0o400 })).toBe(true);
      expect(isReadOnlyStat({ mode: 0o555 })).toBe(true);
    });

    it("returns false when user, group, or other write bits are present", () => {
      expect(isReadOnlyStat({ mode: 0o644 })).toBe(false);
      expect(isReadOnlyStat({ mode: 0o755 })).toBe(false);
      expect(isReadOnlyStat({ mode: 0o666 })).toBe(false);
    });
  });

  describe("getWritePermissionDiagnostic", () => {
    it("returns actionable instructions when file is marked read-only", async () => {
      const filePath = path.join(tmpDir, "readonly.txt");
      await fs.writeFile(filePath, "immutable content");
      await fs.chmod(filePath, 0o444);

      const diagnostic = await getWritePermissionDiagnostic(filePath, "readonly.txt");
      expect(diagnostic).toContain("Permission denied: file is marked read-only on disk (readonly.txt)");
      if (process.platform === "win32") {
        expect(diagnostic).toContain('attrib -r "readonly.txt"');
      } else {
        expect(diagnostic).toContain('chmod +w "readonly.txt"');
      }
    });

    it("returns fallback message for non-read-only permission issues", async () => {
      const filePath = path.join(tmpDir, "writable.txt");
      await fs.writeFile(filePath, "content");
      await fs.chmod(filePath, 0o644);

      const diagnostic = await getWritePermissionDiagnostic(filePath, "writable.txt");
      expect(diagnostic).toContain("Permission denied writing file: writable.txt");
    });
  });
});
