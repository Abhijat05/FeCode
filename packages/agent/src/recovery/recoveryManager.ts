import * as fs from "fs/promises";
import * as path from "path";
import type {
  RecoveryConflict,
  RecoveryManager,
  RecoveryOptions,
  RecoveryPreview,
  RecoveryPreviewFile,
  RecoveryRecord,
  RecoveryResult
} from "./types.js";
import type { CheckpointStore } from "../checkpoints/types.js";
import { DefaultCheckpointStore } from "../checkpoints/checkpointStore.js";
import type { GitRepository } from "../git/types.js";
import { DefaultGitRepository, type GitCommandRunner } from "../git/gitRepository.js";
import { performRecoverySafetyCheck } from "./safety.js";
import {
  createEmergencySnapshot,
  cleanupEmergencySnapshot,
  restoreEmergencySnapshot
} from "./emergencySnapshot.js";

export class DefaultRecoveryManager implements RecoveryManager {
  private readonly store: CheckpointStore;
  private readonly gitRepo: GitRepository;
  private readonly runner: GitCommandRunner;
  private lastRecord: RecoveryRecord | null = null;

  constructor(
    store?: CheckpointStore,
    gitRepo?: GitRepository,
    runner?: GitCommandRunner
  ) {
    this.store = store || new DefaultCheckpointStore();
    this.gitRepo = gitRepo || new DefaultGitRepository();
    this.runner = runner || DefaultGitRepository.defaultRunner;
  }

  public getLastRecord(): RecoveryRecord | null {
    return this.lastRecord ? { ...this.lastRecord } : null;
  }

  public async preview(
    checkpointId: string,
    cwd: string
  ): Promise<RecoveryPreview> {
    const cp = await this.store.get(checkpointId);
    if (!cp) {
      return {
        checkpointId,
        currentBranch: null,
        checkpointBranch: null,
        repositoryRoot: cwd,
        files: [],
        totalFiles: 0,
        preExistingFiles: [],
        safe: false,
        reasons: [`Checkpoint not found: ${checkpointId}`],
        conflicts: []
      };
    }

    const safety = await performRecoverySafetyCheck(cp, cwd, this.gitRepo);
    const previewFiles: RecoveryPreviewFile[] = [];

    const isGit = await this.gitRepo.isRepository(cwd);
    let currentBranch: string | null = null;

    if (isGit) {
      const currentStatus = await this.gitRepo.getStatus(cwd);
      currentBranch = currentStatus.branch;

      for (const file of safety.affectedFiles) {
        const curr = currentStatus.files.find((f) => f.path === file);
        const op: "restore" | "delete" | "revert" =
          curr?.indexStatus === "?" || curr?.worktreeStatus === "?" || curr?.indexStatus === "A"
            ? "delete"
            : "restore";

        previewFiles.push({
          path: file,
          operation: op,
          additions: op === "delete" ? 0 : 1,
          deletions: op === "delete" ? 1 : 1
        });
      }
    } else {
      for (const file of safety.affectedFiles) {
        previewFiles.push({
          path: file,
          operation: "restore",
          additions: 0,
          deletions: 1
        });
      }
    }

    previewFiles.sort((a, b) => a.path.localeCompare(b.path));

    return {
      checkpointId: cp.id,
      currentBranch,
      checkpointBranch: cp.branch,
      repositoryRoot: cp.repositoryRoot,
      files: previewFiles,
      totalFiles: previewFiles.length,
      preExistingFiles: safety.preservedFiles,
      safe: safety.safe,
      reasons: safety.reasons,
      conflicts: safety.conflicts
    };
  }

  public async recover(
    checkpointId: string,
    options: RecoveryOptions
  ): Promise<RecoveryResult> {
    const startedAt = new Date().toISOString();

    if (options.signal?.aborted) {
      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "cancelled",
        affectedFiles: [],
        preservedFiles: [],
        conflicts: []
      };
      return {
        success: false,
        checkpointId,
        status: "cancelled",
        recoveredFiles: [],
        preservedFiles: [],
        conflicts: [],
        error: "Recovery was cancelled."
      };
    }

    const cp = await this.store.get(checkpointId);
    if (!cp) {
      const conflicts: RecoveryConflict[] = [
        { path: "", reason: `Checkpoint not found: ${checkpointId}` }
      ];
      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "blocked",
        affectedFiles: [],
        preservedFiles: [],
        conflicts: [`Checkpoint not found: ${checkpointId}`]
      };
      return {
        success: false,
        checkpointId,
        status: "blocked",
        recoveredFiles: [],
        preservedFiles: [],
        conflicts,
        error: `Checkpoint not found: ${checkpointId}`
      };
    }

    const safety = await performRecoverySafetyCheck(cp, options.cwd, this.gitRepo);

    if (!safety.safe) {
      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "blocked",
        affectedFiles: safety.affectedFiles,
        preservedFiles: safety.preservedFiles,
        conflicts: safety.conflicts.map((c) => `${c.path}: ${c.reason}`).concat(safety.reasons)
      };
      return {
        success: false,
        checkpointId,
        status: "blocked",
        recoveredFiles: [],
        preservedFiles: safety.preservedFiles,
        conflicts: safety.conflicts,
        error: safety.reasons.join("; ") || "Safety checks failed"
      };
    }

    if (options.approved !== true) {
      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "blocked",
        affectedFiles: safety.affectedFiles,
        preservedFiles: safety.preservedFiles,
        conflicts: ["User approval was not granted"]
      };
      return {
        success: false,
        checkpointId,
        status: "blocked",
        recoveredFiles: [],
        preservedFiles: safety.preservedFiles,
        conflicts: [],
        error: "Recovery requires explicit user approval."
      };
    }

    // Create emergency snapshot before mutation
    const emergencySnapshotPath = await createEmergencySnapshot(
      safety.affectedFiles,
      options.cwd,
      checkpointId
    );

    try {
      const isGit = await this.gitRepo.isRepository(options.cwd);
      let currentStatus = isGit ? await this.gitRepo.getStatus(options.cwd) : null;

      for (const relPath of safety.affectedFiles) {
        if (options.signal?.aborted) {
          throw new Error("Recovery cancelled during execution.");
        }

        const fullPath = path.resolve(options.cwd, relPath);
        const currEntry = currentStatus?.files.find((f) => f.path === relPath);

        if (
          currEntry?.indexStatus === "?" ||
          currEntry?.worktreeStatus === "?" ||
          currEntry?.indexStatus === "A"
        ) {
          // Newly added / untracked file: safe removal
          try {
            await fs.unlink(fullPath);
          } catch {
            // Ignore if already deleted
          }
        } else if (isGit) {
          // Tracked file modified/deleted by FeCode: checkout specific file only
          const checkoutRes = await this.runner(
            ["checkout", "HEAD", "--", relPath],
            options.cwd,
            options.signal
          );
          if (checkoutRes.exitCode !== 0) {
            throw new Error(
              `Failed to checkout file ${relPath}: ${checkoutRes.stderr}`
            );
          }
        }
      }

      // Verify post-recovery status
      if (isGit) {
        currentStatus = await this.gitRepo.getStatus(options.cwd);
      }

      // Clean up emergency snapshot on success
      await cleanupEmergencySnapshot(emergencySnapshotPath);

      // Update checkpoint status to restored
      try {
        await this.store.save({
          ...cp,
          status: "restored"
        });
      } catch {
        // Ignore store update error
      }

      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        affectedFiles: safety.affectedFiles,
        preservedFiles: safety.preservedFiles,
        conflicts: []
      };

      return {
        success: true,
        checkpointId,
        status: "completed",
        recoveredFiles: safety.affectedFiles,
        preservedFiles: safety.preservedFiles,
        conflicts: []
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Attempt emergency rollback
      await restoreEmergencySnapshot(emergencySnapshotPath, options.cwd);

      this.lastRecord = {
        checkpointId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        affectedFiles: safety.affectedFiles,
        preservedFiles: safety.preservedFiles,
        conflicts: [msg]
      };

      return {
        success: false,
        checkpointId,
        status: "failed",
        recoveredFiles: [],
        preservedFiles: safety.preservedFiles,
        conflicts: [],
        error: msg,
        emergencySnapshotPath
      };
    }
  }
}
