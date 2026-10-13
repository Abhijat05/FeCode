import * as fs from "fs/promises";
import * as path from "path";

export interface GitLockStatus {
  hasLock: boolean;
  lockPath: string;
  isStale: boolean;
  ageMs: number;
}

/**
 * Resolves the path to .git/index.lock for a given directory,
 * correctly handling both standard git repositories and git worktrees
 * (where .git is a file containing `gitdir: ...`).
 */
export async function resolveGitIndexLockPath(cwd: string): Promise<string | null> {
  const dotGit = path.join(cwd, ".git");
  try {
    const stats = await fs.stat(dotGit);
    if (stats.isDirectory()) {
      return path.join(dotGit, "index.lock");
    }
    if (stats.isFile()) {
      // It's a worktree; read gitdir reference
      const content = await fs.readFile(dotGit, "utf-8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        const gitDir = path.resolve(cwd, match[1].trim());
        return path.join(gitDir, "index.lock");
      }
    }
  } catch {
    // Not a git repository or unreadable
  }
  return null;
}

/**
 * Checks if .git/index.lock exists and determines whether it is stale.
 * A lock is considered stale if its mtime is older than staleThresholdMs (default 5000ms),
 * or if forceStale is set (e.g. after a process timeout or abrupt termination).
 */
export async function checkGitLockStatus(
  cwd: string,
  staleThresholdMs: number = 5000
): Promise<GitLockStatus | null> {
  const lockPath = await resolveGitIndexLockPath(cwd);
  if (!lockPath) return null;

  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const isStale = ageMs >= staleThresholdMs;
    return {
      hasLock: true,
      lockPath,
      isStale,
      ageMs
    };
  } catch {
    return null;
  }
}

/**
 * Removes a stale .git/index.lock file if it exists and is stale.
 * Returns true if a lock was successfully removed, false otherwise.
 */
export async function cleanStaleGitLock(
  cwd: string,
  force: boolean = false,
  staleThresholdMs: number = 5000
): Promise<{ removed: boolean; lockPath?: string; ageMs?: number }> {
  const status = await checkGitLockStatus(cwd, staleThresholdMs);
  if (!status || (!status.isStale && !force)) {
    return { removed: false };
  }

  try {
    await fs.unlink(status.lockPath);
    return {
      removed: true,
      lockPath: status.lockPath,
      ageMs: status.ageMs
    };
  } catch {
    return { removed: false };
  }
}
