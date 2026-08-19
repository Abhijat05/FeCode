import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  createEmergencySnapshot,
  restoreEmergencySnapshot,
  cleanupEmergencySnapshot
} from "./emergencySnapshot.js";

describe("EmergencySnapshot — Phase 5H", () => {
  let tmpWorkDir: string;

  beforeEach(async () => {
    tmpWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-em-work-"));
    await fs.mkdir(path.join(tmpWorkDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpWorkDir, "src", "App.tsx"),
      "original content\n",
      "utf-8"
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("creates, restores, and cleans up emergency snapshot", async () => {
    const snapshotPath = await createEmergencySnapshot(
      ["src/App.tsx"],
      tmpWorkDir,
      "checkpoint-test-1"
    );

    expect(snapshotPath).toBeDefined();
    const backupFile = path.join(snapshotPath, "src", "App.tsx");
    const backupContent = await fs.readFile(backupFile, "utf-8");
    expect(backupContent).toBe("original content\n");

    // Modify file
    await fs.writeFile(
      path.join(tmpWorkDir, "src", "App.tsx"),
      "corrupted mutation\n",
      "utf-8"
    );

    // Restore from emergency snapshot
    await restoreEmergencySnapshot(snapshotPath, tmpWorkDir);
    const restoredContent = await fs.readFile(
      path.join(tmpWorkDir, "src", "App.tsx"),
      "utf-8"
    );
    expect(restoredContent).toBe("original content\n");

    // Clean up
    await cleanupEmergencySnapshot(snapshotPath);
    await expect(fs.stat(snapshotPath)).rejects.toThrow();
  });

  it("ignores secret files from emergency snapshot", async () => {
    await fs.writeFile(path.join(tmpWorkDir, ".env"), "SECRET=123\n", "utf-8");

    const snapshotPath = await createEmergencySnapshot(
      [".env", "src/App.tsx"],
      tmpWorkDir,
      "checkpoint-test-2"
    );

    const envBackup = path.join(snapshotPath, ".env");
    await expect(fs.stat(envBackup)).rejects.toThrow();

    await cleanupEmergencySnapshot(snapshotPath);
  });
});
