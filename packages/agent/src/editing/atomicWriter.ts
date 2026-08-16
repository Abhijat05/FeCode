import * as fs from "fs/promises";
import * as path from "path";

export async function writeAtomic(
  targetPath: string,
  content: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("CANCELLED");
  }

  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = path.join(
    dir,
    `.tmp.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`
  );

  let tempCreated = false;
  try {
    if (signal?.aborted) {
      throw new Error("CANCELLED");
    }

    await fs.writeFile(tempPath, content, "utf-8");
    tempCreated = true;

    if (signal?.aborted) {
      throw new Error("CANCELLED");
    }

    await fs.rename(tempPath, targetPath);
    tempCreated = false;
  } catch (err: unknown) {
    if (tempCreated) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
    throw err;
  }
}
