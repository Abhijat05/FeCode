import type {
  Checkpoint,
  CheckpointApproval,
  CheckpointApprovalRequest,
  CheckpointComparison,
  CheckpointComparisonFile,
  CheckpointConsumptionResult,
  CheckpointCreateOptions,
  CheckpointFile,
  CheckpointManager,
  CheckpointRecord,
  CheckpointResult,
  CheckpointStatus,
  CheckpointStore,
  CheckpointValidationContext,
  CheckpointValidationResult
} from "./types.js";
import { DefaultCheckpointStore } from "./checkpointStore.js";
import { DefaultGitRepository } from "../git/gitRepository.js";
import type { GitRepository } from "../git/types.js";
import type { TaskRiskLevel } from "../policy/types.js";
import * as fs from "fs/promises";

const RISK_LEVEL_ORDER: Record<TaskRiskLevel, number> = {
  low: 1,
  normal: 2,
  elevated: 3,
  critical: 4
};

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
  private readonly records = new Map<string, CheckpointRecord>();

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

  // --- Phase 5Y Approval Lifecycle Methods ---

  public async requestApproval(
    request: CheckpointApprovalRequest
  ): Promise<CheckpointRecord> {
    const checkpointId = generateCheckpointId();
    const now = Date.now();
    const ttl = request.ttlMs ?? 300000; // default 5 minutes
    const expiresAt = now + ttl;

    let branch: string | null = null;
    try {
      if (await this.gitRepo.isRepository(request.cwd)) {
        branch = await this.gitRepo.getBranch(request.cwd);
      }
    } catch {
      // non-fatal
    }

    const record: CheckpointRecord = {
      checkpointId,
      runId: request.runId,
      planId: request.planId,
      stepId: request.stepId,
      stepOrder: request.stepOrder,
      createdAt: now,
      expiresAt,
      riskLevel: request.riskLevel,
      reason: request.reason,
      affectedTargets: [...request.affectedTargets],
      requiredAction: request.requiredAction,
      status: "pending",
      branch
    };

    this.records.set(checkpointId, record);
    return { ...record };
  }

  public async approve(
    checkpointId: string,
    approval: CheckpointApproval
  ): Promise<CheckpointRecord> {
    const record = this.records.get(checkpointId);
    if (!record) {
      throw new Error(`Checkpoint record not found: ${checkpointId}`);
    }

    if (record.expiresAt && Date.now() > record.expiresAt) {
      record.status = "expired";
      record.invalidationReason = "Checkpoint has expired";
      throw new Error(`Checkpoint ${checkpointId} has expired`);
    }

    if (record.status !== "pending") {
      throw new Error(
        `Cannot approve checkpoint in status '${record.status}'. Only pending checkpoints can be approved.`
      );
    }

    record.status = "approved";
    record.approval = { ...approval };
    return { ...record };
  }

  public async reject(
    checkpointId: string,
    reason?: string
  ): Promise<CheckpointRecord> {
    const record = this.records.get(checkpointId);
    if (!record) {
      throw new Error(`Checkpoint record not found: ${checkpointId}`);
    }

    if (record.status === "consumed") {
      throw new Error(
        `Cannot reject checkpoint ${checkpointId}: it has already been consumed.`
      );
    }

    record.status = "rejected";
    record.invalidationReason = reason || "Rejected by user";
    record.approval = {
      approved: false,
      approvedBy: "user",
      decision: "rejected",
      timestamp: Date.now(),
      reason: record.invalidationReason
    };
    return { ...record };
  }

  public async validateApproval(
    checkpointId: string,
    context: CheckpointValidationContext
  ): Promise<CheckpointValidationResult> {
    const record = this.records.get(checkpointId);
    if (!record) {
      return {
        valid: false,
        status: "invalid",
        checkpointId,
        reason: `Checkpoint record not found: ${checkpointId}`,
        invalidated: true
      };
    }

    // Check expiration
    if (record.expiresAt && Date.now() > record.expiresAt) {
      record.status = "expired";
      record.invalidationReason = "Checkpoint has expired";
      return {
        valid: false,
        status: "expired",
        checkpointId,
        reason: "Checkpoint has expired",
        invalidated: true
      };
    }

    // Check status is approved
    if (record.status !== "approved") {
      return {
        valid: false,
        status: record.status,
        checkpointId,
        reason: `Checkpoint is not in approved status (current status: ${record.status})`
      };
    }

    // Check Run ID binding
    if (record.runId !== context.runId) {
      record.status = "invalidated";
      record.invalidationReason = `Run ID mismatch: checkpoint belongs to run '${record.runId}', but validation attempted for run '${context.runId}'`;
      return {
        valid: false,
        status: "invalidated",
        checkpointId,
        reason: record.invalidationReason,
        invalidated: true
      };
    }

    // Check Plan ID binding
    if (record.planId && context.planId && record.planId !== context.planId) {
      record.status = "invalidated";
      record.invalidationReason = `Plan ID mismatch: checkpoint belongs to plan '${record.planId}', but validation attempted for plan '${context.planId}'`;
      return {
        valid: false,
        status: "invalidated",
        checkpointId,
        reason: record.invalidationReason,
        invalidated: true
      };
    }

    // Check Step ID binding
    if (record.stepId && context.stepId && record.stepId !== context.stepId) {
      record.status = "invalidated";
      record.invalidationReason = `Step ID mismatch: checkpoint belongs to step '${record.stepId}', but validation attempted for step '${context.stepId}'`;
      return {
        valid: false,
        status: "invalidated",
        checkpointId,
        reason: record.invalidationReason,
        invalidated: true
      };
    }

    // Check Risk Level escalation
    const recordRiskOrder = RISK_LEVEL_ORDER[record.riskLevel] ?? 2;
    const contextRiskOrder = RISK_LEVEL_ORDER[context.riskLevel] ?? 2;
    if (contextRiskOrder > recordRiskOrder) {
      record.status = "invalidated";
      record.invalidationReason = `Risk level escalated from '${record.riskLevel}' to '${context.riskLevel}'. A fresh approval is required.`;
      return {
        valid: false,
        status: "invalidated",
        checkpointId,
        reason: record.invalidationReason,
        invalidated: true
      };
    }

    // Check Git branch change
    if (record.branch && context.gitRepository) {
      try {
        const currentBranch = await context.gitRepository.getBranch(context.cwd);
        if (currentBranch && currentBranch !== record.branch) {
          record.status = "invalidated";
          record.invalidationReason = `Git branch changed from '${record.branch}' to '${currentBranch}'. Workspace state has drifted.`;
          return {
            valid: false,
            status: "invalidated",
            checkpointId,
            reason: record.invalidationReason,
            invalidated: true
          };
        }
      } catch {
        // non-fatal
      }
    }

    return {
      valid: true,
      status: "approved",
      checkpointId
    };
  }

  public async consume(
    checkpointId: string,
    context: CheckpointValidationContext
  ): Promise<CheckpointConsumptionResult> {
    const record = this.records.get(checkpointId);
    if (!record) {
      return {
        success: false,
        checkpointId,
        status: "invalid",
        error: `Checkpoint record not found: ${checkpointId}`
      };
    }

    // If already consumed, single-use consumption strictly prevents reuse
    if (record.status === "consumed") {
      return {
        success: false,
        checkpointId,
        status: "consumed",
        error: `Checkpoint ${checkpointId} has already been consumed.`
      };
    }

    const valResult = await this.validateApproval(checkpointId, context);
    if (!valResult.valid) {
      return {
        success: false,
        checkpointId,
        status: valResult.status,
        error: valResult.reason
      };
    }

    // Atomic consumption transition
    record.status = "consumed";
    record.consumedAt = Date.now();

    return {
      success: true,
      checkpointId,
      status: "consumed",
      consumedAt: record.consumedAt
    };
  }

  public async invalidate(
    checkpointId: string,
    reason: string
  ): Promise<CheckpointRecord> {
    const record = this.records.get(checkpointId);
    if (!record) {
      throw new Error(`Checkpoint record not found: ${checkpointId}`);
    }

    record.status = "invalidated";
    record.invalidationReason = reason;
    return { ...record };
  }

  public async getRecord(
    checkpointId: string
  ): Promise<CheckpointRecord | null> {
    const record = this.records.get(checkpointId);
    return record ? { ...record } : null;
  }

  public async listRecords(filter?: {
    runId?: string;
    planId?: string;
    status?: CheckpointStatus;
  }): Promise<CheckpointRecord[]> {
    let list = Array.from(this.records.values());
    if (filter?.runId) {
      list = list.filter((r) => r.runId === filter.runId);
    }
    if (filter?.planId) {
      list = list.filter((r) => r.planId === filter.planId);
    }
    if (filter?.status) {
      list = list.filter((r) => r.status === filter.status);
    }
    return list.map((r) => ({ ...r }));
  }
}
