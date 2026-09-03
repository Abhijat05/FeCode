import * as fs from "fs/promises";
import * as path from "path";
import type {
  PlanStalenessResult,
  PlanStep,
  TaskPlan
} from "./types.js";
import type { GitRepository } from "../git/types.js";
import type { WorkspaceFingerprint } from "../history/types.js";

export interface StalenessCheckOptions {
  cwd: string;
  gitRepository?: GitRepository;
  initialFingerprint?: WorkspaceFingerprint;
  initialGitBranch?: string;
}

/**
 * Detects whether an approved plan has become stale before step execution.
 * Checks for:
 * 1. Disappearance of expected target files for read/modify operations.
 * 2. Unexpected Git branch change.
 * 3. Unexpected Git commit / workspace fingerprint drift.
 */
export async function detectPlanStaleness(
  _plan: TaskPlan,
  step: PlanStep,
  options: StalenessCheckOptions
): Promise<PlanStalenessResult> {
  const now = Date.now();

  // 1. Check if Git branch changed
  if (options.gitRepository && options.initialGitBranch) {
    try {
      const currentBranch = await options.gitRepository.getBranch(
        options.cwd
      );
      if (currentBranch && currentBranch !== options.initialGitBranch) {
        return {
          stale: true,
          reason: `Git branch changed from '${options.initialGitBranch}' to '${currentBranch}'`,
          affectedStep: step.stepId,
          timestamp: now
        };
      }
    } catch {
      // Non-fatal git inspection error
    }
  }

  // 2. Check if target file disappeared for inspect/modify operations
  const targetFile =
    step.intent?.target ||
    (step.expectedFiles && step.expectedFiles.length > 0
      ? step.expectedFiles[0]
      : undefined);

  if (
    targetFile &&
    step.intent?.type !== "create_file" &&
    (step.intent?.type === "modify_file" ||
      step.intent?.type === "inspect_file" ||
      step.type === "modify")
  ) {
    const fullPath = path.isAbsolute(targetFile)
      ? targetFile
      : path.join(options.cwd, targetFile);

    try {
      await fs.access(fullPath);
    } catch {
      return {
        stale: true,
        reason: `Target file '${targetFile}' does not exist or is not accessible in workspace`,
        affectedStep: step.stepId,
        timestamp: now
      };
    }
  }

  // 3. Check workspace branch drift if initial fingerprint had gitBranch
  if (options.gitRepository && options.initialFingerprint?.gitBranch) {
    try {
      const currentBranch = await options.gitRepository.getBranch(
        options.cwd
      );
      if (
        currentBranch &&
        currentBranch !== options.initialFingerprint.gitBranch
      ) {
        return {
          stale: true,
          reason: `Workspace git branch changed from '${options.initialFingerprint.gitBranch}' to '${currentBranch}'`,
          affectedStep: step.stepId,
          timestamp: now
        };
      }
    } catch {
      // Non-fatal git error
    }
  }

  // 4. Check workspace file drift if initial fingerprint had fileFingerprints
  if (targetFile && options.initialFingerprint?.fileFingerprints) {
    const fullPath = path.isAbsolute(targetFile)
      ? targetFile
      : path.join(options.cwd, targetFile);
    const initialFileFp =
      options.initialFingerprint.fileFingerprints[fullPath] ||
      options.initialFingerprint.fileFingerprints[targetFile];

    if (initialFileFp) {
      try {
        const stats = await fs.stat(fullPath);
        if (
          (initialFileFp.size !== undefined && stats.size !== initialFileFp.size) ||
          (initialFileFp.mtimeMs !== undefined && Math.abs(stats.mtimeMs - initialFileFp.mtimeMs) > 1000)
        ) {
          return {
            stale: true,
            reason: `Target file '${targetFile}' was modified outside the execution plan`,
            affectedStep: step.stepId,
            timestamp: now
          };
        }
      } catch {
        // Handled in target file existence check
      }
    }
  }

  return {
    stale: false,
    timestamp: now
  };
}
