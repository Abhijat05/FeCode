import * as fs from "fs/promises";
import * as path from "path";
import { getDefaultHistoryDir } from "./pathResolver.js";
import { sanitizeDurableRunRecord } from "./sanitizer.js";
import type { RunSummary } from "../diagnostics/types.js";
import type {
  DurableRunRecord,
  RunHistoryStore,
  RunHistoryStoreOptions,
  WorkspaceFingerprint
} from "./types.js";

function isValidRunId(runId: string): boolean {
  if (!runId || typeof runId !== "string") return false;
  return /^[a-zA-Z0-9_.-]+$/.test(runId) && !runId.includes("..");
}

export class DefaultRunHistoryStore implements RunHistoryStore {
  private readonly storageDir: string;
  private readonly maxRuns: number;
  private readonly maxSizeBytes: number;

  constructor(options: RunHistoryStoreOptions = {}) {
    this.storageDir = options.storageDir || getDefaultHistoryDir();
    this.maxRuns = options.maxRuns ?? 100;
    this.maxSizeBytes = options.maxSizeBytes ?? 50 * 1024 * 1024; // 50 MB default
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  public async saveRun(
    recordOrSummary: DurableRunRecord | RunSummary,
    projectId?: string,
    fingerprint?: WorkspaceFingerprint,
    parentRunId?: string,
    resumeDepth?: number
  ): Promise<void> {
    const runId = recordOrSummary.runId;
    if (!isValidRunId(runId)) {
      throw new Error(`Invalid runId: ${runId}`);
    }

    try {
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    } catch {
      // ignore directory creation error
    }

    let durableRecord: DurableRunRecord;
    if ("schemaVersion" in recordOrSummary && recordOrSummary.schemaVersion === 1) {
      durableRecord = {
        ...recordOrSummary,
        projectId: projectId || recordOrSummary.projectId || "default",
        parentRunId: parentRunId || recordOrSummary.parentRunId,
        resumeDepth: resumeDepth ?? recordOrSummary.resumeDepth,
        workspaceFingerprint: fingerprint || recordOrSummary.workspaceFingerprint
      };
    } else {
      const summary = recordOrSummary as RunSummary;
      durableRecord = {
        schemaVersion: 1,
        runId: summary.runId,
        parentRunId: parentRunId || summary.parentRunId,
        resumeDepth: resumeDepth ?? summary.resumeDepth,
        projectId: projectId || "default",
        cwd: summary.cwd,
        userRequestSummary: summary.userRequestSummary,
        startedAt: summary.startedAt,
        completedAt: summary.completedAt,
        durationMs: summary.durationMs,
        finalStatus: summary.finalStatus,
        executionState:
          summary.finalStatus === "completed"
            ? "completed"
            : summary.finalStatus === "cancelled"
              ? "cancelled"
              : summary.finalStatus === "failed"
                ? "failed"
                : "interrupted",
        activeSkills: summary.activeSkills || [],
        initialRiskLevel: summary.initialRiskLevel,
        riskReasons: summary.riskReasons || [],
        requiresCheckpoint: summary.requiresCheckpoint,
        requiresExplicitApproval: summary.requiresExplicitApproval,
        checkpointId: summary.checkpointId,
        verificationAttempts: summary.verificationAttempts,
        maxVerificationAttempts: summary.maxVerificationAttempts,
        recoveryAttempts: summary.recoveryAttempts,
        maxRecoveryAttempts: summary.maxRecoveryAttempts,
        tools: summary.tools || [],
        commands: summary.commands || [],
        recovery: summary.recovery || [],
        files: summary.files || { modified: [], created: [], deleted: [] },
        lifecycleTransitions: summary.lifecycleTransitions || [],
        workspaceFingerprint: fingerprint,
        failureReason: summary.failureReason,
        failureCode: summary.failureCode,
        cancellationReason: summary.cancellationReason,
        planId: summary.planId,
        planStatus: summary.planStatus,
        totalPlanSteps: summary.totalPlanSteps,
        completedPlanSteps: summary.completedPlanSteps,
        failedPlanStep: summary.failedPlanStep,
        skippedPlanSteps: summary.skippedPlanSteps,
        replanCount: summary.replanCount,
        parentPlanId: summary.parentPlanId,
        replanDepth: summary.replanDepth,
        replanReason: summary.replanReason,
        replanTimestamp: summary.replanTimestamp,
        planSummary: summary.planSummary,
        planExecutionDurationMs: summary.planExecutionDurationMs,
        feedbackCount: summary.feedbackCount,
        blockingFeedbackCount: summary.blockingFeedbackCount,
        retryCount: summary.retryCount,
        adaptationCount: summary.adaptationCount,
        blockedPlanSteps: summary.blockedPlanSteps,
        planAdaptationReasons: summary.planAdaptationReasons,
        decisionRequestedAt: summary.decisionRequestedAt,
        decisionResolvedAt: summary.decisionResolvedAt,
        executionDecision: summary.executionDecision,
        decisionReason: summary.decisionReason,
        decisionOutcome: summary.decisionOutcome,
        resumedFromStepId: summary.resumedFromStepId,
        resumedStepOrder: summary.resumedStepOrder,
        decisionCount: summary.decisionCount,
        reconciliationId: summary.reconciliationId,
        reconciliationStatus: summary.reconciliationStatus,
        reconciliationStartedAt: summary.reconciliationStartedAt,
        reconciliationCompletedAt: summary.reconciliationCompletedAt,
        expectedFileCount: summary.expectedFileCount,
        modifiedFileCount: summary.modifiedFileCount,
        unexpectedFileCount: summary.unexpectedFileCount,
        missingFileCount: summary.missingFileCount,
        reconciliationConsistent: summary.reconciliationConsistent,
        reconciliationFailureReason: summary.reconciliationFailureReason
      };
    }

    const sanitized = sanitizeDurableRunRecord(durableRecord);
    const serialized = JSON.stringify(sanitized, null, 2);

    const tempFile = path.join(
      this.storageDir,
      `${runId}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`
    );
    const targetFile = path.join(this.storageDir, `${runId}.json`);

    try {
      await fs.writeFile(tempFile, serialized, {
        encoding: "utf-8",
        mode: 0o600
      });
      await fs.rename(tempFile, targetFile);
    } catch (err: unknown) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // ignore
      }
      throw err;
    }

    // Deterministic retention pruning
    try {
      await this.prune();
    } catch {
      // Ignore prune errors
    }
  }

  public async getRun(runId: string): Promise<DurableRunRecord | null> {
    if (!isValidRunId(runId)) {
      return null;
    }

    const targetFile = path.join(this.storageDir, `${runId}.json`);

    try {
      const raw = await fs.readFile(targetFile, "utf-8");
      const parsed = JSON.parse(raw) as DurableRunRecord;
      if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  public async getRunLineage(runId: string): Promise<DurableRunRecord[]> {
    if (!isValidRunId(runId)) {
      return [];
    }

    const lineage: DurableRunRecord[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = runId;

    while (currentId) {
      if (visited.has(currentId)) {
        // Cycle detected: prevent infinite loop
        break;
      }
      visited.add(currentId);

      const record = await this.getRun(currentId);
      if (!record) {
        break;
      }

      lineage.push(record);
      currentId = record.parentRunId;
    }

    return lineage;
  }

  public async listRuns(options: {
    projectId?: string;
    limit?: number;
  } = {}): Promise<DurableRunRecord[]> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(this.storageDir, { withFileTypes: true });
      const jsonFiles = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".tmp")
      );

      const records: DurableRunRecord[] = [];
      for (const f of jsonFiles) {
        const fullPath = path.join(this.storageDir, f.name);
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          const parsed = JSON.parse(raw) as DurableRunRecord;
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.schemaVersion === 1 &&
            parsed.runId
          ) {
            if (!options.projectId || parsed.projectId === options.projectId) {
              records.push(parsed);
            }
          }
        } catch {
          // Ignore corrupt file
        }
      }

      // Sort newest first
      records.sort((a, b) => b.startedAt - a.startedAt);

      if (options.limit && options.limit > 0) {
        return records.slice(0, options.limit);
      }

      return records;
    } catch {
      return [];
    }
  }

  public async deleteRun(runId: string): Promise<boolean> {
    if (!isValidRunId(runId)) {
      return false;
    }

    const targetFile = path.join(this.storageDir, `${runId}.json`);
    try {
      await fs.unlink(targetFile);
      return true;
    } catch {
      return false;
    }
  }

  public async clearRuns(projectId?: string): Promise<void> {
    try {
      const runs = await this.listRuns({ projectId });
      for (const run of runs) {
        await this.deleteRun(run.runId);
      }
    } catch {
      // Ignore
    }
  }

  public async prune(
    maxRuns: number = this.maxRuns,
    maxSizeBytes: number = this.maxSizeBytes
  ): Promise<number> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(this.storageDir, { withFileTypes: true });
      const jsonFiles = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".tmp")
      );

      interface FileMeta {
        name: string;
        fullPath: string;
        size: number;
        mtimeMs: number;
      }

      const metas: FileMeta[] = [];
      let totalSize = 0;

      for (const f of jsonFiles) {
        const fullPath = path.join(this.storageDir, f.name);
        try {
          const stat = await fs.stat(fullPath);
          metas.push({
            name: f.name,
            fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
          totalSize += stat.size;
        } catch {
          // Ignore
        }
      }

      // Sort oldest first for eviction
      metas.sort((a, b) => a.mtimeMs - b.mtimeMs);

      let evictedCount = 0;

      // 1. Evict by count
      while (metas.length > maxRuns) {
        const oldest = metas.shift();
        if (oldest) {
          try {
            await fs.unlink(oldest.fullPath);
            totalSize -= oldest.size;
            evictedCount++;
          } catch {
            // Ignore
          }
        }
      }

      // 2. Evict by size
      while (totalSize > maxSizeBytes && metas.length > 0) {
        const oldest = metas.shift();
        if (oldest) {
          try {
            await fs.unlink(oldest.fullPath);
            totalSize -= oldest.size;
            evictedCount++;
          } catch {
            // Ignore
          }
        }
      }

      return evictedCount;
    } catch {
      return 0;
    }
  }
}
