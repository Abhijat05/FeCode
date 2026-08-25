import * as fs from "fs/promises";
import * as path from "path";
import type {
  FinalReconciliationPolicy,
  FinalReconciliationResult,
  FinalReconciliationStatus,
  FinalWorkspaceReconciler,
  TaskPlan
} from "./types.js";
import type { GitRepository } from "../git/types.js";
import type { WorkspaceFingerprint } from "../history/types.js";

export class DefaultFinalWorkspaceReconciler implements FinalWorkspaceReconciler {
  public async reconcile(params: {
    runId: string;
    plan: TaskPlan;
    cwd: string;
    initialFingerprint?: WorkspaceFingerprint;
    gitRepository?: GitRepository;
    verificationPassed?: boolean;
    policy?: FinalReconciliationPolicy;
  }): Promise<FinalReconciliationResult> {
    const policy: Required<FinalReconciliationPolicy> = {
      required: params.policy?.required ?? true,
      allowUnexpectedFiles: params.policy?.allowUnexpectedFiles ?? false,
      allowBranchChange: params.policy?.allowBranchChange ?? false,
      allowMissingExpectedFiles: params.policy?.allowMissingExpectedFiles ?? false
    };

    const allExpectedFiles = new Set<string>();
    const expectedCreatedOrModified = new Set<string>();
    const expectedDeleted = new Set<string>();

    for (const step of params.plan.steps) {
      const targets: string[] = [];
      if (step.intent?.target) {
        targets.push(step.intent.target);
      }
      if (step.expectedFiles) {
        for (const f of step.expectedFiles) {
          if (!targets.includes(f)) targets.push(f);
        }
      }

      for (const t of targets) {
        if (!t) continue;
        const normalized = path.isAbsolute(t) ? path.relative(params.cwd, t) : t;
        allExpectedFiles.add(normalized);

        if (step.intent?.type === "delete_file") {
          expectedDeleted.add(normalized);
        } else if (
          step.intent?.type === "create_file" ||
          step.intent?.type === "modify_file" ||
          step.type === "modify" ||
          step.type === "configure"
        ) {
          expectedCreatedOrModified.add(normalized);
        }
      }
    }

    const missingFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const unexpectedFiles: string[] = [];
    const changedFiles: string[] = [];

    // 1. Check expected created / modified files
    for (const relPath of expectedCreatedOrModified) {
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(params.cwd, relPath);
      try {
        const stats = await fs.stat(fullPath);
        const initialFp =
          params.initialFingerprint?.fileFingerprints?.[relPath] ||
          params.initialFingerprint?.fileFingerprints?.[fullPath];

        if (initialFp) {
          if (
            (initialFp.size !== undefined && stats.size !== initialFp.size) ||
            (initialFp.mtimeMs !== undefined && Math.abs(stats.mtimeMs - initialFp.mtimeMs) > 1000)
          ) {
            modifiedFiles.push(relPath);
            changedFiles.push(relPath);
          }
        } else {
          // Newly created file
          modifiedFiles.push(relPath);
          changedFiles.push(relPath);
        }
      } catch {
        missingFiles.push(relPath);
      }
    }

    // 2. Check expected deleted files
    for (const relPath of expectedDeleted) {
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(params.cwd, relPath);
      try {
        await fs.access(fullPath);
        // If still accessible, deletion failed!
        missingFiles.push(relPath);
      } catch {
        // File is deleted as expected
        changedFiles.push(relPath);
      }
    }

    // 3. Check for unexpected workspace changes in tracked files
    if (params.initialFingerprint?.fileFingerprints) {
      for (const [trackedFile, initialMeta] of Object.entries(
        params.initialFingerprint.fileFingerprints
      )) {
        const normalizedTracked = path.isAbsolute(trackedFile)
          ? path.relative(params.cwd, trackedFile)
          : trackedFile;

        if (
          !allExpectedFiles.has(normalizedTracked) &&
          !allExpectedFiles.has(trackedFile)
        ) {
          const fullPath = path.isAbsolute(trackedFile)
            ? trackedFile
            : path.join(params.cwd, trackedFile);
          try {
            const stats = await fs.stat(fullPath);
            if (
              (initialMeta.size !== undefined && stats.size !== initialMeta.size) ||
              (initialMeta.mtimeMs !== undefined &&
                Math.abs(stats.mtimeMs - initialMeta.mtimeMs) > 1000)
            ) {
              unexpectedFiles.push(normalizedTracked);
              if (!changedFiles.includes(normalizedTracked)) {
                changedFiles.push(normalizedTracked);
              }
            }
          } catch {
            // File was deleted unexpectedly
            unexpectedFiles.push(normalizedTracked);
            if (!changedFiles.includes(normalizedTracked)) {
              changedFiles.push(normalizedTracked);
            }
          }
        }
      }
    }

    // 4. Check git branch
    let branchChanged = false;
    if (params.gitRepository && params.initialFingerprint?.gitBranch) {
      try {
        const currentBranch = await params.gitRepository.getBranch(params.cwd);
        if (
          currentBranch &&
          currentBranch !== params.initialFingerprint.gitBranch
        ) {
          branchChanged = true;
        }
      } catch {
        // Non-fatal git inspection error
      }
    }

    const verificationPassed = params.verificationPassed ?? true;

    // 5. Evaluate consistency
    const failureReasons: string[] = [];
    if (missingFiles.length > 0 && !policy.allowMissingExpectedFiles) {
      failureReasons.push(`Missing expected files: ${missingFiles.join(", ")}`);
    }
    if (unexpectedFiles.length > 0 && !policy.allowUnexpectedFiles) {
      failureReasons.push(
        `Unexpected workspace modifications: ${unexpectedFiles.join(", ")}`
      );
    }
    if (branchChanged && !policy.allowBranchChange) {
      failureReasons.push("Git branch changed during execution");
    }
    if (!verificationPassed) {
      failureReasons.push("Verification checks failed");
    }

    const consistent = failureReasons.length === 0;
    const status: FinalReconciliationStatus = consistent ? "consistent" : "inconsistent";

    const result: FinalReconciliationResult = Object.freeze({
      reconciliationId: `recon-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      runId: params.runId,
      planId: params.plan.planId,
      status,
      checkedAt: Date.now(),
      expectedFiles: Array.from(allExpectedFiles),
      modifiedFiles,
      unexpectedFiles,
      missingFiles,
      changedFiles,
      branchChanged,
      workspaceChanged: changedFiles.length > 0 || branchChanged,
      verificationPassed,
      consistent,
      failureReason: failureReasons.length > 0 ? failureReasons.join("; ") : undefined
    });

    return result;
  }
}
