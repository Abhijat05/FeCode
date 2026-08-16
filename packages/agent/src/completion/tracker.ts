import type { TaskPlan } from "../tasks/types.js";
import type {
  TaskCompletionStatus,
  TaskCompletionSummary,
  TaskRequirement,
  RequirementStatus,
  FileChangeStats
} from "./types.js";

export class TaskCompletionTracker {
  private taskId?: string;
  private taskIndex?: number;
  private request?: string;
  private startedAt?: string;
  private modifiedFiles: Set<string> = new Set();
  private fileChangesMap: Map<string, FileChangeStats> = new Map();
  private verifiedCommands: Set<string> = new Set();
  private failedCommands: Set<string> = new Set();
  private requirements: Map<string, TaskRequirement> = new Map();
  private status: TaskCompletionStatus = "pending";
  private blockedReason?: string;
  private isNoOp = false;

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
      this.status = "in_progress";
      this.isNoOp = false;
    }
  }

  public recordFileChange(change: FileChangeStats): void {
    if (change && change.path) {
      const clean = change.path.trim().replace(/\\/g, "/");
      this.modifiedFiles.add(clean);
      this.fileChangesMap.set(clean, { ...change, path: clean });
      this.status = "in_progress";
      this.isNoOp = false;
    }
  }

  public recordCommandVerified(command: string): void {
    if (command && command.trim()) {
      this.verifiedCommands.add(command.trim());
      this.failedCommands.delete(command.trim());
    }
  }

  public recordCommandFailed(command: string): void {
    if (command && command.trim()) {
      this.failedCommands.add(command.trim());
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

    const fileChanges = Array.from(this.fileChangesMap.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    return {
      taskId: this.taskId,
      taskIndex: this.taskIndex,
      request: this.request,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      completedFiles: Array.from(this.modifiedFiles).sort(),
      fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
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
      if (summary.verifiedCommands.length > 0) {
        text += `\nVerified:\n${summary.verifiedCommands.map((c) => `  ${c}`).join("\n")}\n`;
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
    this.fileChangesMap.clear();
    this.verifiedCommands.clear();
    this.failedCommands.clear();
    this.requirements.clear();
    this.status = "pending";
    this.blockedReason = undefined;
    this.isNoOp = false;
  }
}
