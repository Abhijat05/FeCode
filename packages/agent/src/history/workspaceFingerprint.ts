import * as fs from "fs/promises";
import * as path from "path";
import type { GitRepository } from "../git/types.js";
import type { WorkspaceFingerprint } from "./types.js";

export async function captureWorkspaceFingerprint(
  cwd: string,
  filesToTrack?: string[],
  gitRepo?: GitRepository
): Promise<WorkspaceFingerprint> {
  const fingerprint: WorkspaceFingerprint = {
    capturedAt: Date.now()
  };

  if (gitRepo) {
    try {
      const isRepo = await gitRepo.isRepository(cwd);
      if (isRepo) {
        const status = await gitRepo.getStatus(cwd);
        fingerprint.gitBranch = status.branch || undefined;
        fingerprint.isGitDirty = status.files.length > 0;
      }
    } catch {
      // Ignore git errors
    }
  }

  if (filesToTrack && filesToTrack.length > 0) {
    const fileMap: Record<
      string,
      { mtimeMs?: number; size?: number; hash?: string }
    > = {};

    for (const relPath of filesToTrack) {
      if (!relPath) continue;
      const fullPath = path.isAbsolute(relPath)
        ? relPath
        : path.join(cwd, relPath);
      try {
        const stat = await fs.stat(fullPath);
        fileMap[relPath] = {
          mtimeMs: Math.round(stat.mtimeMs),
          size: stat.size
        };
      } catch {
        fileMap[relPath] = {};
      }
    }
    fingerprint.fileFingerprints = fileMap;
  }

  return fingerprint;
}

export function compareWorkspaceFingerprints(
  saved?: WorkspaceFingerprint,
  current?: WorkspaceFingerprint
): { matches: boolean; reasons: string[] } {
  if (!saved || !current) {
    return { matches: true, reasons: [] };
  }

  const reasons: string[] = [];

  if (saved.gitBranch && current.gitBranch && saved.gitBranch !== current.gitBranch) {
    reasons.push(
      `Git branch changed from "${saved.gitBranch}" to "${current.gitBranch}"`
    );
  }

  if (
    saved.isGitDirty !== undefined &&
    current.isGitDirty !== undefined &&
    saved.isGitDirty !== current.isGitDirty
  ) {
    reasons.push(
      `Working tree dirty state changed (originally ${saved.isGitDirty ? "dirty" : "clean"}, now ${current.isGitDirty ? "dirty" : "clean"})`
    );
  }

  if (saved.fileFingerprints && current.fileFingerprints) {
    for (const [filePath, savedMeta] of Object.entries(saved.fileFingerprints)) {
      const currentMeta = current.fileFingerprints[filePath];
      if (!currentMeta) {
        reasons.push(`Tracked file "${filePath}" is missing in current workspace`);
      } else if (savedMeta.size !== undefined && currentMeta.size === undefined) {
        reasons.push(`Tracked file "${filePath}" was deleted from disk`);
      } else if (
        savedMeta.size !== undefined &&
        currentMeta.size !== undefined &&
        savedMeta.size !== currentMeta.size
      ) {
        reasons.push(
          `File "${filePath}" size changed (${savedMeta.size}B -> ${currentMeta.size}B)`
        );
      } else if (
        savedMeta.mtimeMs !== undefined &&
        currentMeta.mtimeMs !== undefined &&
        Math.abs(savedMeta.mtimeMs - currentMeta.mtimeMs) > 1000
      ) {
        reasons.push(`File "${filePath}" modified on disk since original run`);
      }
    }
  }

  return {
    matches: reasons.length === 0,
    reasons
  };
}
