import * as fs from "fs/promises";
import * as path from "path";
import { getDefaultRecoverySnapshotsDir } from "./pathResolver.js";
import { isSecretFile } from "../editing/validator.js";

export async function createEmergencySnapshot(
  files: string[],
  cwd: string,
  checkpointId: string
): Promise<string> {
  const baseDir = getDefaultRecoverySnapshotsDir();
  const rand = Math.random().toString(36).substring(2, 7);
  const snapshotDir = path.join(
    baseDir,
    `${checkpointId}-${Date.now()}-${rand}`
  );

  await fs.mkdir(snapshotDir, { recursive: true, mode: 0o700 });

  for (const relPath of files) {
    if (isSecretFile(relPath)) continue;

    const sourceFile = path.resolve(cwd, relPath);
    const destFile = path.join(snapshotDir, relPath);

    try {
      const stat = await fs.stat(sourceFile);
      if (stat.isFile()) {
        await fs.mkdir(path.dirname(destFile), { recursive: true });
        await fs.copyFile(sourceFile, destFile);
      }
    } catch {
      // File might not exist (e.g. was deleted), which is fine
    }
  }

  return snapshotDir;
}

export async function restoreEmergencySnapshot(
  snapshotDir: string,
  cwd: string
): Promise<void> {
  try {
    const entries = await getAllFilesRecursive(snapshotDir);
    for (const file of entries) {
      const relPath = path.relative(snapshotDir, file);
      const destFile = path.resolve(cwd, relPath);
      await fs.mkdir(path.dirname(destFile), { recursive: true });
      await fs.copyFile(file, destFile);
    }
  } catch {
    // Ignore errors during emergency restore
  }
}

export async function cleanupEmergencySnapshot(
  snapshotDir: string
): Promise<void> {
  try {
    await fs.rm(snapshotDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}

async function getAllFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await getAllFilesRecursive(fullPath);
        results.push(...sub);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore
  }
  return results;
}
