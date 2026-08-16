import type { TaskPlan } from "../tasks/types.js";
import type {
  TaskCompletionStatus,
  TaskCompletionSummary,
  TaskRequirement,
  RequirementStatus
} from "./types.js";

export class TaskCompletionTracker {
  private modifiedFiles: Set<string> = new Set();
  private verifiedCommands: Set<string> = new Set();
  private requirements: Map<string, TaskRequirement> = new Map();
  private status: TaskCompletionStatus = "pending";
  private blockedReason?: string;

  public recordFileModified(filePath: string): void {
    if (filePath && filePath.trim()) {
      this.modifiedFiles.add(filePath.trim());
      this.status = "in_progress";
    }
  }

  public recordCommandVerified(command: string): void {
    if (command && command.trim()) {
      this.verifiedCommands.add(command.trim());
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

    return {
      status: this.status,
      completedFiles: Array.from(this.modifiedFiles).sort(),
      verifiedCommands: Array.from(this.verifiedCommands).sort(),
      completedRequirements: completedReqs.sort(),
      remainingRequirements: remainingReqs.sort(),
      blockedReason: this.blockedReason
    };
  }

  public formatSummary(summary: TaskCompletionSummary): string {
    if (summary.status === "completed") {
      let text = "✓ Task completed\n";
      if (summary.completedFiles.length > 0) {
        text += `\nChanged:\n${summary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
      }
      if (summary.verifiedCommands.length > 0) {
        text += `\nVerified:\n${summary.verifiedCommands.map((c) => `  ${c}`).join("\n")}\n`;
      }
      return text;
    }

    if (summary.status === "blocked") {
      let text = "⚠ Task blocked\n";
      if (summary.blockedReason) {
        text += `\nReason:\n  ${summary.blockedReason}\n`;
      }
      if (summary.completedFiles.length > 0) {
        text += `\nChanged:\n${summary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
      }
      if (summary.remainingRequirements.length > 0) {
        text += `\nRemaining:\n${summary.remainingRequirements.map((r) => `  ${r}`).join("\n")}\n`;
      }
      return text;
    }

    if (summary.status === "cancelled") {
      return "⚠ Task cancelled\n";
    }

    return `● Task in progress\n`;
  }

  public reset(): void {
    this.modifiedFiles.clear();
    this.verifiedCommands.clear();
    this.requirements.clear();
    this.status = "pending";
    this.blockedReason = undefined;
  }
}
