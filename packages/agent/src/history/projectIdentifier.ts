import * as crypto from "crypto";
import * as path from "path";
import type { GitRepository } from "../git/types.js";

export async function getProjectIdentifier(
  cwd: string,
  gitRepo?: GitRepository
): Promise<string> {
  const normalizedCwd = path.resolve(cwd).replace(/[\\/]+/g, "/").toLowerCase();
  let root = normalizedCwd;

  if (gitRepo) {
    try {
      const isRepo = await gitRepo.isRepository(cwd);
      if (isRepo) {
        const rootRes = await gitRepo.getRoot(cwd);
        if (rootRes) {
          root = path.resolve(rootRes).replace(/[\\/]+/g, "/").toLowerCase();
        }
      }
    } catch {
      // Fallback to normalized cwd
    }
  }

  const baseName = path.basename(root).replace(/[^a-zA-Z0-9_-]/g, "_") || "project";
  const hash = crypto.createHash("sha256").update(root).digest("hex").substring(0, 12);

  return `${baseName}-${hash}`;
}
