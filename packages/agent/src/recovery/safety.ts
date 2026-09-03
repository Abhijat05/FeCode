import * as path from "path";
import type { Checkpoint } from "../checkpoints/types.js";
import type { GitRepository, GitStatus } from "../git/types.js";
import type { RecoveryConflict, RecoverySafetyCheck } from "./types.js";
import { isSecretFile } from "../editing/validator.js";

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

export async function performRecoverySafetyCheck(
  checkpoint: Checkpoint,
  cwd: string,
  gitRepo: GitRepository
): Promise<RecoverySafetyCheck> {
  const conflicts: RecoveryConflict[] = [];
  const reasons: string[] = [];
  const affectedFiles: string[] = [];
  const preservedFiles: string[] = [];

  // 1. Checkpoint status validity
  if (checkpoint.status === "discarded") {
    reasons.push("Checkpoint has been discarded");
    return {
      safe: false,
      conflicts,
      affectedFiles,
      preservedFiles,
      reasons
    };
  }

  if (
    checkpoint.status !== "ready" &&
    checkpoint.status !== "created" &&
    checkpoint.status !== "active" &&
    checkpoint.status !== "restored"
  ) {
    reasons.push("Checkpoint is invalid or corrupted");
    return {
      safe: false,
      conflicts,
      affectedFiles,
      preservedFiles,
      reasons
    };
  }

  // 2. Repository inspection
  const isGit = await gitRepo.isRepository(cwd);
  let currentStatus: GitStatus | null = null;
  let currentRoot = cwd;

  if (isGit) {
    currentStatus = await gitRepo.getStatus(cwd);
    currentRoot = currentStatus.root || cwd;

    // Check repository root identity
    if (normalizePath(checkpoint.repositoryRoot) !== normalizePath(currentRoot)) {
      reasons.push("Checkpoint repository mismatch");
    }

    // Check branch identity
    if (
      checkpoint.branch &&
      currentStatus.branch &&
      checkpoint.branch !== currentStatus.branch
    ) {
      reasons.push("Checkpoint branch differs from current branch");
    }

    // Check merge conflicts
    if (currentStatus.hasConflicts) {
      reasons.push("Repository contains merge conflicts");
    }
  } else {
    // Non-Git repository check
    if (normalizePath(checkpoint.repositoryRoot) !== normalizePath(cwd)) {
      reasons.push("Checkpoint repository mismatch");
    }
    reasons.push("Automatic file recovery is only supported in Git repositories");
  }

  // 3. File status comparison and conflict detection
  const cpFileMap = new Map(checkpoint.files.map((f) => [f.path, f.status]));

  if (isGit && currentStatus) {
    for (const curr of currentStatus.files) {
      // Check for protected files
      if (isSecretFile(curr.path)) {
        conflicts.push({
          path: curr.path,
          reason: "Protected file cannot be restored automatically"
        });
        continue;
      }

      const cpStatus = cpFileMap.get(curr.path);

      if (!cpStatus) {
        // File was created after checkpoint (e.g. untracked or added by FeCode)
        affectedFiles.push(curr.path);
      } else if (cpStatus === "modified" || cpStatus === "untracked") {
        // Pre-existing change captured in checkpoint
        preservedFiles.push(curr.path);
      } else {
        affectedFiles.push(curr.path);
      }
    }

    // Files that were in checkpoint but deleted after checkpoint
    for (const cpFile of checkpoint.files) {
      if (isSecretFile(cpFile.path)) continue;
      const currentEntry = currentStatus.files.find((f) => f.path === cpFile.path);
      if (!currentEntry && !affectedFiles.includes(cpFile.path)) {
        preservedFiles.push(cpFile.path);
      }
    }
  } else {
    // Non-git safe attribution
    for (const cpFile of checkpoint.files) {
      if (isSecretFile(cpFile.path)) {
        conflicts.push({
          path: cpFile.path,
          reason: "Protected file cannot be restored automatically"
        });
        continue;
      }
      preservedFiles.push(cpFile.path);
    }
  }

  // Deterministic sorting
  affectedFiles.sort();
  preservedFiles.sort();
  conflicts.sort((a, b) => a.path.localeCompare(b.path));

  const safe = reasons.length === 0 && conflicts.length === 0;

  return {
    safe,
    conflicts,
    affectedFiles,
    preservedFiles,
    reasons
  };
}
