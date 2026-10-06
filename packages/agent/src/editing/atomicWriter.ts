import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

export interface WriteAtomicOptions {
  signal?: AbortSignal;
  /** Custom rename function for testing / dependency injection */
  renameFn?: (oldPath: string, newPath: string) => Promise<void>;
  /** Custom copy function for testing / dependency injection */
  copyFn?: (src: string, dest: string) => Promise<void>;
}

export async function writeAtomic(
  targetPath: string,
  content: string,
  signalOrOptions?: AbortSignal | WriteAtomicOptions
): Promise<void> {
  const options: WriteAtomicOptions =
    signalOrOptions instanceof AbortSignal
      ? { signal: signalOrOptions }
      : (signalOrOptions ?? {});

  const signal = options.signal;
  const renameFn = options.renameFn ?? fs.rename;
  const copyFn = options.copyFn ?? fs.copyFile;

  if (signal?.aborted) {
    throw new Error("CANCELLED");
  }

  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const rawBaseName = path.basename(targetPath);
  // Prevent ENAMETOOLONG on long filenames by hashing the basename if it exceeds 64 characters
  const safeBaseName =
    rawBaseName.length > 64
      ? crypto.createHash("sha256").update(rawBaseName).digest("hex").slice(0, 16)
      : rawBaseName;

  const randomSuffix = `${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
  const tempPath = path.join(dir, `.tmp.${safeBaseName}.${randomSuffix}`);
  const backupPath = path.join(dir, `.bak.${safeBaseName}.${randomSuffix}`);

  let tempCreated = false;
  let backupCreated = false;

  try {
    if (signal?.aborted) {
      throw new Error("CANCELLED");
    }

    await fs.writeFile(tempPath, content, "utf-8");
    tempCreated = true;

    if (signal?.aborted) {
      throw new Error("CANCELLED");
    }

    try {
      await renameFn(tempPath, targetPath);
      tempCreated = false;
    } catch (renameErr: unknown) {
      const code = (renameErr as { code?: string })?.code;
      if (code === "EPERM" || code === "EEXIST" || code === "EBUSY" || code === "EXDEV") {
        // Target file might already exist. Check before overwriting.
        let targetExists = false;
        try {
          await fs.stat(targetPath);
          targetExists = true;
        } catch {
          targetExists = false;
        }

        if (targetExists) {
          // Backup the existing file so that if copying fails (e.g. disk full ENOSPC),
          // the target file will NOT be left truncated or zeroed!
          await copyFn(targetPath, backupPath);
          backupCreated = true;
        }

        try {
          await copyFn(tempPath, targetPath);
        } catch (copyErr: unknown) {
          // If copy failed mid-stream, restore the original content from backup!
          if (backupCreated) {
            try {
              try {
                await fs.rename(backupPath, targetPath);
                backupCreated = false;
              } catch {
                await fs.copyFile(backupPath, targetPath);
              }
            } catch {
              // Best effort restore
            }
          }
          throw copyErr;
        }

        await fs.unlink(tempPath);
        tempCreated = false;
      } else {
        throw renameErr;
      }
    }
  } finally {
    if (tempCreated) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
    if (backupCreated) {
      try {
        await fs.unlink(backupPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}
