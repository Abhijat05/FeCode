import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  resolveGitIndexLockPath,
  checkGitLockStatus,
  cleanStaleGitLock
} from "./gitLockUtils.js";

describe("gitLockUtils", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-gitlock-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null for non-git directory", async () => {
    const lockPath = await resolveGitIndexLockPath(tmpDir);
    expect(lockPath).toBeNull();

    const status = await checkGitLockStatus(tmpDir);
    expect(status).toBeNull();

    const cleanResult = await cleanStaleGitLock(tmpDir);
    expect(cleanResult.removed).toBe(false);
  });

  it("resolves lock path in a standard git repository", async () => {
    const dotGit = path.join(tmpDir, ".git");
    await fs.mkdir(dotGit);

    const lockPath = await resolveGitIndexLockPath(tmpDir);
    expect(lockPath).toBe(path.join(dotGit, "index.lock"));

    const statusNoLock = await checkGitLockStatus(tmpDir);
    expect(statusNoLock).toBeNull();
  });

  it("resolves lock path in a git worktree referencing gitdir", async () => {
    const mainGitDir = path.join(tmpDir, "main-repo", ".git", "worktrees", "wt-1");
    await fs.mkdir(mainGitDir, { recursive: true });

    const worktreeDir = path.join(tmpDir, "wt-dir");
    await fs.mkdir(worktreeDir);

    const dotGitFile = path.join(worktreeDir, ".git");
    await fs.writeFile(dotGitFile, `gitdir: ${mainGitDir}\n`, "utf-8");

    const resolved = await resolveGitIndexLockPath(worktreeDir);
    expect(resolved).toBe(path.join(mainGitDir, "index.lock"));
  });

  it("detects fresh lock as not stale and does not remove unless forced", async () => {
    const dotGit = path.join(tmpDir, ".git");
    await fs.mkdir(dotGit);
    const lockFile = path.join(dotGit, "index.lock");
    await fs.writeFile(lockFile, "lock contents", "utf-8");

    const status = await checkGitLockStatus(tmpDir, 5000);
    expect(status).not.toBeNull();
    expect(status?.hasLock).toBe(true);
    expect(status?.isStale).toBe(false);

    // cleanStaleGitLock without force should not delete a fresh lock
    const cleanAttempt = await cleanStaleGitLock(tmpDir, false, 5000);
    expect(cleanAttempt.removed).toBe(false);

    // Verify file still exists
    const exists = await fs.stat(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("detects and removes stale lock when older than threshold", async () => {
    const dotGit = path.join(tmpDir, ".git");
    await fs.mkdir(dotGit);
    const lockFile = path.join(dotGit, "index.lock");
    await fs.writeFile(lockFile, "lock contents", "utf-8");

    // Artificially age the file mtime by 10 seconds
    const tenSecondsAgo = (Date.now() - 10000) / 1000;
    await fs.utimes(lockFile, tenSecondsAgo, tenSecondsAgo);

    const status = await checkGitLockStatus(tmpDir, 5000);
    expect(status).not.toBeNull();
    expect(status?.hasLock).toBe(true);
    expect(status?.isStale).toBe(true);

    const cleanResult = await cleanStaleGitLock(tmpDir, false, 5000);
    expect(cleanResult.removed).toBe(true);
    expect(cleanResult.lockPath).toBe(lockFile);

    // Verify file is gone
    const exists = await fs.stat(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("force removes fresh lock if force is true", async () => {
    const dotGit = path.join(tmpDir, ".git");
    await fs.mkdir(dotGit);
    const lockFile = path.join(dotGit, "index.lock");
    await fs.writeFile(lockFile, "lock contents", "utf-8");

    const cleanResult = await cleanStaleGitLock(tmpDir, true, 5000);
    expect(cleanResult.removed).toBe(true);

    const exists = await fs.stat(lockFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
