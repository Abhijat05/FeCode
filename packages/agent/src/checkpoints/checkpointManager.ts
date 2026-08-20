import type {
  Checkpoint,
  CheckpointComparison,
  CheckpointComparisonFile,
  CheckpointCreateOptions,
  CheckpointFile,
  CheckpointManager,
  CheckpointResult,
  CheckpointStore
} from "./types.js";
import { DefaultCheckpointStore } from "./checkpointStore.js";
import { DefaultGitRepository } from "../git/gitRepository.js";
import type { GitRepository } from "../git/types.js";
import * as fs from "fs/promises";

function generateCheckpointId(): string {
  const now = new Date();
  const dateStr = now
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15)
    .replace("T", "-");
  const rand = Math.random().toString(36).substring(2, 6);
  return `checkpoint-${dateStr}-${rand}`;
}

export class DefaultCheckpointManager implements CheckpointManager {
  private readonly store: CheckpointStore;
  private readonly gitRepo: GitRepository;

  constructor(store?: CheckpointStore, gitRepo?: GitRepository) {
    this.store = store || new DefaultCheckpointStore();
    this.gitRepo = gitRepo || new DefaultGitRepository();
  }

  public async create(
    options: CheckpointCreateOptions
  ): Promise<CheckpointResult> {
    if (options.signal?.aborted) {
      return {
        success: false,
        error: "Checkpoint creation cancelled.",
        code: "ABORTED"
      };
    }

    try {
      const id = generateCheckpointId();
      const isGit = await this.gitRepo.isRepository(options.cwd);

      let root = options.cwd;
      let branch: string | null = null;
      const files: CheckpointFile[] = [];

      if (isGit) {
        const status = await this.gitRepo.getStatus(options.cwd);
        root = status.root || options.cwd;
        branch = status.branch;

        for (const f of status.files) {
          files.push({
            path: f.path,
            status:
              f.indexStatus === "?" || f.worktreeStatus === "?"
                ? "untracked"
                : "modified"
          });
        }
      } else {
        // Non-git filesystem inspection
        try {
          const dirEntries = await fs.readdir(options.cwd, { withFileTypes: true });
          for (const entry of dirEntries) {
            if (entry.isFile() && !entry.name.startsWith(".")) {
              files.push({
                path: entry.name,
                status: "tracked"
              });
            }
          }
        } catch {
          // Ignore filesystem reading errors
        }
      }

      if (options.signal?.aborted) {
        return {
          success: false,
          error: "Checkpoint creation cancelled.",
          code: "ABORTED"
        };
      }

      const checkpoint: Checkpoint = {
        id,
        taskId: options.taskId,
        createdAt: new Date().toISOString(),
        repositoryRoot: root.replace(/\\/g, "/"),
        branch,
        files,
        totalFiles: files.length,
        status: "created",
        isGit,
        reason: options.reason,
        reasons: options.reasons || (options.reason ? [options.reason] : []),
        affectedFiles: options.affectedFiles
      };

      await this.store.save(checkpoint);

      return {
        success: true,
        checkpoint,
        code: "CHECKPOINT_CREATED"
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: msg,
        code: "CHECKPOINT_FAILED"
      };
    }
  }

  public async get(id: string): Promise<Checkpoint | null> {
    return this.store.get(id);
  }

  public async inspect(id: string): Promise<Checkpoint | null> {
    const cp = await this.store.get(id);
    if (!cp) return null;

    return {
      ...cp,
      status: cp.status || "created"
    };
  }

  public async compare(
    id: string,
    cwd: string
  ): Promise<CheckpointComparison> {
    const cp = await this.inspect(id);
    if (!cp) {
      throw new Error(`Checkpoint not found: ${id}`);
    }

    const comparisonFiles: CheckpointComparisonFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    const isGit = await this.gitRepo.isRepository(cwd);
    if (isGit) {
      const currentStatus = await this.gitRepo.getStatus(cwd);

      for (const curr of currentStatus.files) {
        const op: "added" | "modified" | "deleted" =
          curr.indexStatus === "?" || curr.worktreeStatus === "?" || curr.indexStatus === "A"
            ? "added"
            : curr.indexStatus === "D" || curr.worktreeStatus === "D"
              ? "deleted"
              : "modified";

        const adds = op === "deleted" ? 0 : 1;
        const dels = op === "added" ? 0 : 1;

        totalAdditions += adds;
        totalDeletions += dels;

        comparisonFiles.push({
          path: curr.path,
          operation: op,
          additions: adds,
          deletions: dels
        });
      }
    }

    // Sort files deterministically
    comparisonFiles.sort((a, b) => a.path.localeCompare(b.path));

    return {
      checkpointId: cp.id,
      createdAt: cp.createdAt,
      files: comparisonFiles,
      totalAdditions,
      totalDeletions
    };
  }

  public async list(): Promise<Checkpoint[]> {
    return this.store.list();
  }

  public async remove(id: string): Promise<void> {
    return this.store.remove(id);
  }

  public async discard(id: string): Promise<void> {
    const cp = await this.store.get(id);
    if (cp) {
      await this.store.save({
        ...cp,
        status: "discarded"
      });
    }
  }

  public async restore(
    id: string,
    options: import("../recovery/types.js").RecoveryOptions = { cwd: process.cwd() }
  ): Promise<import("../recovery/types.js").RecoveryResult> {
    const { DefaultRecoveryManager } = await import(
      "../recovery/recoveryManager.js"
    );
    const recoveryManager = new DefaultRecoveryManager(
      this.store,
      this.gitRepo
    );
    return recoveryManager.recover(id, options);
  }
}
