import type { TaskPlan } from "../tasks/types.js";
import type {
  TaskCompletionStatus,
  TaskCompletionSummary,
  TaskRequirement,
  RequirementStatus,
  FileChangeStats
} from "./types.js";
import { ChangeSetBuilder } from "../changes/changeSetBuilder.js";
import type { ChangeSetCommand } from "../changes/types.js";

export class TaskCompletionTracker {
  private taskId?: string;
  private taskIndex?: number;
  private request?: string;
  private startedAt?: string;
  private modifiedFiles: Set<string> = new Set();
  private changeSetBuilder: ChangeSetBuilder = new ChangeSetBuilder();
  private verifiedCommands: Set<string> = new Set();
  private failedCommands: Set<string> = new Set();
  private requirements: Map<string, TaskRequirement> = new Map();
  private status: TaskCompletionStatus = "pending";
  private blockedReason?: string;
  private isNoOp = false;
  private baselineSnapshot?: import("../git/types.js").RepositorySnapshot;
  private postTaskSnapshot?: import("../git/types.js").RepositorySnapshot;
  private gitBranch?: string | null;
  private gitAttribution?: import("../git/types.js").ChangeAttribution;
  private checkpointId?: string;
  private recoveryRecord?: import("../recovery/types.js").RecoveryRecord;

  public setRecoveryRecord(record: import("../recovery/types.js").RecoveryRecord | undefined): void {
    this.recoveryRecord = record;
  }

  public setCheckpointId(id: string | undefined): void {
    this.checkpointId = id;
  }

  public setBaselineSnapshot(snapshot: import("../git/types.js").RepositorySnapshot): void {
    this.baselineSnapshot = snapshot;
    if (snapshot.branch) {
      this.gitBranch = snapshot.branch;
    }
  }

  public setPostTaskSnapshot(snapshot: import("../git/types.js").RepositorySnapshot): void {
    this.postTaskSnapshot = snapshot;
    if (snapshot.branch) {
      this.gitBranch = snapshot.branch;
    }
  }

  public setGitBranch(branch: string | null): void {
    this.gitBranch = branch;
  }

  public setGitAttribution(attribution: import("../git/types.js").ChangeAttribution): void {
    this.gitAttribution = attribution;
  }

  public getBaselineSnapshot(): import("../git/types.js").RepositorySnapshot | undefined {
    return this.baselineSnapshot;
  }

  public setRequest(request: string): void {
    this.request = request;
    if (!this.startedAt) {
      this.startedAt = new Date().toISOString();
    }
  }

  public setTaskIndex(index: number): void {
    this.taskIndex = index;
  }

  public setTaskId(id: string): void {
    this.taskId = id;
  }

  public setNoOp(noOp: boolean): void {
    this.isNoOp = noOp;
  }

  public recordFileModified(filePath: string): void {
    if (filePath && filePath.trim()) {
      const clean = filePath.trim().replace(/\\/g, "/");
      this.modifiedFiles.add(clean);
      this.changeSetBuilder.recordFileChange({
        path: clean,
        operation: "modified",
        additions: 0,
        deletions: 0
      });
      this.status = "in_progress";
      this.isNoOp = false;
    }
  }

  public recordFileChange(change: FileChangeStats): void {
    if (change && change.path) {
      const clean = change.path.trim().replace(/\\/g, "/");
      this.modifiedFiles.add(clean);
      this.changeSetBuilder.recordFileChange({
        path: clean,
        operation: change.operation,
        additions: change.additions,
        deletions: change.deletions
      });
      this.status = "in_progress";
      this.isNoOp = false;
    }
  }

  public recordCommandVerified(command: string): void {
    if (command && command.trim()) {
      const clean = command.trim();
      this.verifiedCommands.add(clean);
      this.failedCommands.delete(clean);
      this.changeSetBuilder.recordCommand({
        command: clean,
        exitCode: 0,
        timedOut: false,
        succeeded: true
      });
    }
  }

  public recordCommandFailed(command: string, exitCode: number | null = 1, timedOut: boolean = false): void {
    if (command && command.trim()) {
      const clean = command.trim();
      this.failedCommands.add(clean);
      this.changeSetBuilder.recordCommand({
        command: clean,
        exitCode,
        timedOut,
        succeeded: false
      });
    }
  }

  public recordCommandExecution(cmd: ChangeSetCommand): void {
    if (cmd && cmd.command) {
      const clean = cmd.command.trim();
      this.changeSetBuilder.recordCommand({
        command: clean,
        exitCode: cmd.exitCode,
        timedOut: Boolean(cmd.timedOut),
        succeeded: Boolean(cmd.succeeded)
      });
      if (cmd.succeeded) {
        this.verifiedCommands.add(clean);
        this.failedCommands.delete(clean);
      } else {
        this.failedCommands.add(clean);
      }
    }
  }

  public recordRequirement(req: TaskRequirement): void {
    this.requirements.set(req.id, { ...req });
  }

  public updateRequirementStatus(id: string, status: RequirementStatus): void {
    const existing = this.requirements.get(id);
    if (existing) {
      existing.status = status;
    }
  }

  public recordBlocked(reason: string): void {
    this.status = "blocked";
    this.blockedReason = reason;
  }

  public recordCancelled(): void {
    this.status = "cancelled";
  }

  public setStatus(status: TaskCompletionStatus): void {
    this.status = status;
  }

  public evaluateCompletion(options: {
    hasErrors?: boolean;
    activePlan?: TaskPlan;
    isVerificationRequired?: boolean;
  } = {}): TaskCompletionSummary {
    if (this.status === "cancelled") {
      return this.getSummary();
    }

    if (this.status === "blocked") {
      return this.getSummary();
    }

    if (options.hasErrors) {
      this.status = "in_progress";
      return this.getSummary();
    }

    // If there is an active TaskPlan, check if all steps are completed
    if (options.activePlan) {
      const allPlanStepsDone = options.activePlan.steps.every(
        (s) => s.status === "completed" || s.status === "skipped"
      );
      if (allPlanStepsDone) {
        this.status = "completed";
      } else {
        this.status = "in_progress";
      }
      return this.getSummary();
    }

    // Check if any registered requirements are still pending
    if (this.requirements.size > 0) {
      const remaining = Array.from(this.requirements.values()).filter(
        (r) => r.status === "pending" || r.status === "in_progress"
      );
      if (remaining.length === 0) {
        this.status = "completed";
      } else {
        this.status = "in_progress";
      }
      return this.getSummary();
    }

    // Default completion when no remaining items
    this.status = "completed";
    return this.getSummary();
  }

  public getSummary(): TaskCompletionSummary {
    const completedReqs: string[] = [];
    const remainingReqs: string[] = [];

    for (const req of this.requirements.values()) {
      if (req.status === "completed") {
        completedReqs.push(req.description);
      } else {
        remainingReqs.push(req.description);
      }
    }

    const changeSet = this.changeSetBuilder.build(this.taskId);

    return {
      taskId: this.taskId,
      taskIndex: this.taskIndex,
      request: this.request,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      completedFiles: Array.from(this.modifiedFiles).sort(),
      fileChanges: changeSet.files.length > 0 ? changeSet.files : undefined,
      changeSet: changeSet.files.length > 0 || changeSet.commands.length > 0 ? changeSet : undefined,
      gitBranch: this.gitBranch,
      gitAttribution: this.gitAttribution,
      baselineSnapshot: this.baselineSnapshot,
      checkpointId: this.checkpointId,
      recovery: this.recoveryRecord,
      verifiedCommands: Array.from(this.verifiedCommands).sort(),
      failedCommands:
        this.failedCommands.size > 0
          ? Array.from(this.failedCommands).sort()
          : undefined,
      completedRequirements: completedReqs.sort(),
      remainingRequirements: remainingReqs.sort(),
      blockedReason: this.blockedReason,
      isNoOp: this.isNoOp
    };
  }

  public formatSummary(summary: TaskCompletionSummary): string {
    if (summary.status === "completed") {
      if (summary.isNoOp) {
        return (
          `✓ No changes needed\n\n` +
          `The requested behavior is already implemented.\n`
        );
      }

      let text = "✓ Task completed\n";
      if (summary.request) {
        text += `\nRequest:\n  ${summary.request}\n`;
      }

      if (summary.gitAttribution) {
        if (summary.gitBranch) {
          text += `\nGit:\n  ${summary.gitBranch}\n`;
        }
        const preCount = summary.gitAttribution.preExistingFiles.length;
        text += `\nPre-existing:\n  ${preCount} file${preCount === 1 ? "" : "s"}\n`;

        const totalAdds = summary.changeSet?.stats.totalAdditions ?? (summary.fileChanges ? summary.fileChanges.reduce((a, b) => a + b.additions, 0) : 0);
        const totalDels = summary.changeSet?.stats.totalDeletions ?? (summary.fileChanges ? summary.fileChanges.reduce((a, b) => a + b.deletions, 0) : 0);
        const feCount = summary.gitAttribution.fecodeFiles.length;
        text += `\nFeCode changes:\n  ${feCount} file${feCount === 1 ? "" : "s"} · +${totalAdds} -${totalDels}\n`;

        const unCount = summary.gitAttribution.unattributedFiles.length;
        text += `\nUnattributed:\n  ${unCount} file${unCount === 1 ? "" : "s"}\n`;

        if (summary.gitAttribution.preservedUserFiles.length > 0) {
          text += `\nUser changes preserved:\n`;
          for (const f of summary.gitAttribution.preservedUserFiles) {
            text += `  ✓ ${f}\n`;
          }
        }
      } else if (summary.fileChanges && summary.fileChanges.length > 0) {
        const fileCount = summary.fileChanges.length;
        const totalAdds = summary.changeSet?.stats.totalAdditions ?? summary.fileChanges.reduce((a, b) => a + b.additions, 0);
        const totalDels = summary.changeSet?.stats.totalDeletions ?? summary.fileChanges.reduce((a, b) => a + b.deletions, 0);
        text += `\nChanged:\n  ${fileCount} file${fileCount === 1 ? "" : "s"} · +${totalAdds} -${totalDels}\n`;
        text += summary.fileChanges
          .map(
            (fc) =>
              `  ${fc.path.padEnd(36)} +${fc.additions} -${fc.deletions}`
          )
          .join("\n") + "\n";
      } else if (summary.completedFiles.length > 0) {
        text += `\nChanged:\n${summary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
      }

      if (summary.changeSet?.areas && summary.changeSet.areas.length > 0) {
        text += `\nAreas:\n${summary.changeSet.areas.map((a) => `  ${a}`).join("\n")}\n`;
      }

      if (summary.verifiedCommands.length > 0) {
        text += `\nVerified:\n${summary.verifiedCommands.map((c) => `  ✓ ${c}`).join("\n")}\n`;
      }
      return text;
    }

    if (summary.status === "blocked") {
      let text = "⚠ Task blocked\n";
      if (summary.request) {
        text += `\nRequest:\n  ${summary.request}\n`;
      }
      if (summary.completedRequirements.length > 0) {
        text += `\nCompleted:\n${summary.completedRequirements.map((r) => `  ✓ ${r}`).join("\n")}\n`;
      }
      if (summary.remainingRequirements.length > 0) {
        text += `\nRemaining:\n${summary.remainingRequirements.map((r) => `  ⚠ ${r}`).join("\n")}\n`;
      }
      if (summary.blockedReason) {
        text += `\nReason:\n  ${summary.blockedReason}\n`;
      }
      if (summary.fileChanges && summary.fileChanges.length > 0) {
        text += `\nChanged:\n${summary.fileChanges
          .map(
            (fc) =>
              `  ${fc.path.padEnd(36)} +${fc.additions} -${fc.deletions}`
          )
          .join("\n")}\n`;
      } else if (summary.completedFiles.length > 0) {
        text += `\nChanged:\n${summary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
      }
      if (summary.changeSet?.areas && summary.changeSet.areas.length > 0) {
        text += `\nAreas:\n${summary.changeSet.areas.map((a) => `  ${a}`).join("\n")}\n`;
      }
      return text;
    }

    if (summary.status === "cancelled") {
      let text = "⚠ Task cancelled\n";
      if (summary.request) {
        text += `\nRequest:\n  ${summary.request}\n`;
      }
      if (summary.completedRequirements.length > 0) {
        text += `\nCompleted:\n${summary.completedRequirements.map((r) => `  ✓ ${r}`).join("\n")}\n`;
      }
      if (summary.remainingRequirements.length > 0) {
        text += `\nRemaining:\n${summary.remainingRequirements.map((r) => `  ⚠ ${r}`).join("\n")}\n`;
      }
      return text;
    }

    return `● Task in progress\n`;
  }

  public reset(): void {
    this.taskId = undefined;
    this.taskIndex = undefined;
    this.request = undefined;
    this.startedAt = undefined;
    this.modifiedFiles.clear();
    this.changeSetBuilder.reset();
    this.verifiedCommands.clear();
    this.failedCommands.clear();
    this.requirements.clear();
    this.status = "pending";
    this.blockedReason = undefined;
    this.isNoOp = false;
    this.baselineSnapshot = undefined;
    this.postTaskSnapshot = undefined;
    this.gitBranch = undefined;
    this.gitAttribution = undefined;
    this.checkpointId = undefined;
    this.recoveryRecord = undefined;
  }
}
