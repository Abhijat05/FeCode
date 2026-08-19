import { sanitizeText } from "./sanitizer.js";
import type {
  TaskCompletionSummary,
  TaskCompletionStatus
} from "../completion/types.js";
import type { PersistedSessionData, SessionSummary } from "./types.js";

export interface SessionSummaryWithLatestTask extends SessionSummary {
  latestTaskSummary?: TaskCompletionSummary;
}

export function formatTimeRelative(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) {
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    }
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toISOString().split("T")[0];
  } catch {
    return dateString;
  }
}

function truncateList(items: string[], maxItems = 3): string[] {
  if (items.length <= maxItems) {
    return items;
  }
  const shown = items.slice(0, maxItems);
  const remaining = items.length - maxItems;
  return [...shown, `+${remaining} more`];
}

export function getTaskStatusSymbol(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "blocked":
    case "cancelled":
      return "⚠";
    case "in_progress":
    case "pending":
    default:
      return "●";
  }
}

export class SessionHistoryFormatter {
  public static formatHistory(
    tasks: TaskCompletionSummary[],
    options: { limit?: number; maxChangedFiles?: number } = {}
  ): string {
    const limit = options.limit || 20;
    const maxFiles = options.maxChangedFiles || 3;

    if (!tasks || tasks.length === 0) {
      return "Session History\n\nNo task history available.\n";
    }

    let text = "Session History\n";

    if (tasks.length > limit) {
      text += `\nShowing ${limit} of ${tasks.length} tasks\n`;
    }

    // Newest task first
    const reversed = [...tasks].reverse().slice(0, limit);

    for (let i = 0; i < reversed.length; i++) {
      const task = reversed[i];
      const taskNum = task.taskIndex !== undefined ? task.taskIndex : tasks.length - i;
      const symbol = getTaskStatusSymbol(task.status);
      const req = task.request
        ? sanitizeText(task.request.split("\n")[0])
        : "Untitled task";

      text += `\n${taskNum}. ${symbol} ${req}\n`;

      if (task.status === "completed") {
        text += `   Completed\n`;
        if (task.changeSet && task.changeSet.files.length > 0) {
          const fileWord =
            task.changeSet.stats.totalFiles === 1 ? "file" : "files";
          text += `   ${task.changeSet.stats.totalFiles} ${fileWord} · +${task.changeSet.stats.totalAdditions} -${task.changeSet.stats.totalDeletions}\n`;
          if (task.gitAttribution) {
            const preCount = task.gitAttribution.preExistingFiles.length;
            text += `   ${preCount} pre-existing\n`;
          }
          if (task.gitBranch) {
            text += `   ${task.gitBranch}\n`;
          } else if (task.changeSet.areas.length > 0) {
            text += `   ${task.changeSet.areas.join(", ")}\n`;
          }
        } else if (task.fileChanges && task.fileChanges.length > 0) {
          const fileItems = task.fileChanges
            .slice(0, maxFiles)
            .map((fc) => `${fc.path} +${fc.additions} -${fc.deletions}`);
          if (task.fileChanges.length > maxFiles) {
            fileItems.push(`+${task.fileChanges.length - maxFiles} more`);
          }
          text += `   Changed: ${fileItems.join(", ")}\n`;
        } else if (task.completedFiles && task.completedFiles.length > 0) {
          const files = truncateList(task.completedFiles, maxFiles);
          text += `   Changed: ${files.join(", ")}\n`;
        }
        if (task.verifiedCommands && task.verifiedCommands.length > 0) {
          text += `   Verified: ${task.verifiedCommands.join(", ")}\n`;
        }
        if (task.recovery) {
          text += `   ↩ Recovered ${task.recovery.checkpointId}\n`;
          text += `   ${task.recovery.affectedFiles.length} file${task.recovery.affectedFiles.length === 1 ? "" : "s"} restored\n`;
        }
      } else if (task.status === "blocked") {
        text += `   Blocked\n`;
        if (task.changeSet && task.changeSet.files.length > 0) {
          const fileWord =
            task.changeSet.stats.totalFiles === 1 ? "file" : "files";
          text += `   ${task.changeSet.stats.totalFiles} ${fileWord} · +${task.changeSet.stats.totalAdditions} -${task.changeSet.stats.totalDeletions}\n`;
          if (task.changeSet.areas.length > 0) {
            text += `   ${task.changeSet.areas.join(", ")}\n`;
          }
        }
        if (task.blockedReason) {
          text += `   ${sanitizeText(task.blockedReason)}\n`;
        }
      } else if (task.status === "cancelled") {
        text += `   Cancelled\n`;
      } else {
        text += `   In Progress\n`;
      }
    }

    return text + "\n";
  }

  public static formatTaskList(
    tasks: TaskCompletionSummary[],
    options: { limit?: number } = {}
  ): string {
    const limit = options.limit || 50;

    if (!tasks || tasks.length === 0) {
      return "Tasks\n\nNo tasks recorded in this session.\n";
    }

    let text = "Tasks\n";

    if (tasks.length > limit) {
      text += `\nShowing ${limit} of ${tasks.length} tasks\n`;
    }

    const displayed = tasks.slice(0, limit);

    for (let i = 0; i < displayed.length; i++) {
      const task = displayed[i];
      const taskNum = task.taskIndex !== undefined ? task.taskIndex : i + 1;
      const symbol = getTaskStatusSymbol(task.status);
      const req = task.request
        ? sanitizeText(task.request.split("\n")[0])
        : "Untitled task";

      text += `\n${symbol} ${taskNum}  ${req}`;
    }

    return text + "\n";
  }

  public static formatTaskDetail(
    task: TaskCompletionSummary,
    taskNumber?: number,
    options: { maxChangedFiles?: number } = {}
  ): string {
    const maxFiles = options.maxChangedFiles || 10;
    const num =
      taskNumber !== undefined
        ? taskNumber
        : task.taskIndex !== undefined
          ? task.taskIndex
          : 1;

    let text = `Task ${num}\n\n`;
    text += `Status:\n  ${task.status}\n\n`;

    if (task.request) {
      text += `Request:\n  ${sanitizeText(task.request)}\n\n`;
    }

    if (task.checkpointId) {
      text += `Checkpoint:\n  ${task.checkpointId}\n\n`;
    }

    if (task.recovery) {
      text += `Recovery:\n  ${task.recovery.affectedFiles.length} file${task.recovery.affectedFiles.length === 1 ? "" : "s"} restored\n  ${task.recovery.preservedFiles.length} pre-existing file${task.recovery.preservedFiles.length === 1 ? "" : "s"} preserved\n\n`;
    }

    if (task.status === "completed") {
      if (task.changeSet && task.changeSet.files.length > 0) {
        const fileWord =
          task.changeSet.stats.totalFiles === 1 ? "file" : "files";
        text += `Changes:\n  ${task.changeSet.stats.totalFiles} ${fileWord}\n  +${task.changeSet.stats.totalAdditions} -${task.changeSet.stats.totalDeletions}\n\n`;

        if (task.gitAttribution) {
          text += `Pre-existing before task:\n  ${task.gitAttribution.preExistingFiles.length} file${task.gitAttribution.preExistingFiles.length === 1 ? "" : "s"}\n\n`;
          text += `FeCode-attributed:\n  ${task.gitAttribution.fecodeFiles.length} file${task.gitAttribution.fecodeFiles.length === 1 ? "" : "s"}\n\n`;
          text += `Unattributed:\n  ${task.gitAttribution.unattributedFiles.length} file${task.gitAttribution.unattributedFiles.length === 1 ? "" : "s"}\n\n`;
        }

        if (task.changeSet.areas.length > 0) {
          text += `Areas:\n${task.changeSet.areas.map((a) => `  ${a}`).join("\n")}\n\n`;
        }
      } else if (task.fileChanges && task.fileChanges.length > 0) {
        const changes = task.fileChanges.slice(0, maxFiles);
        text += `Changed:\n${changes.map((fc) => `  ${fc.path}\n  +${fc.additions} -${fc.deletions}`).join("\n\n")}\n\n`;
        if (task.fileChanges.length > maxFiles) {
          text += `  ... (+${task.fileChanges.length - maxFiles} more files)\n\n`;
        }
      } else if (task.completedFiles && task.completedFiles.length > 0) {
        const files = truncateList(task.completedFiles, maxFiles);
        text += `Changed:\n${files.map((f) => `  ${f}`).join("\n")}\n\n`;
      }

      if (task.changeSet?.verification?.attempted) {
        text += `Verification:\n`;
        for (const cmd of task.changeSet.verification.commands) {
          text += `  ✓ ${sanitizeText(cmd)}\n`;
        }
        for (const cmd of task.changeSet.verification.failedCommands) {
          text += `  ✗ ${sanitizeText(cmd)}\n`;
        }
        text += "\n";
      } else if (task.verifiedCommands && task.verifiedCommands.length > 0) {
        text += `Verification:\n${task.verifiedCommands.map((c) => `  ${c}`).join("\n")}\n\n`;
      }
    } else if (task.status === "blocked") {
      if (task.completedRequirements && task.completedRequirements.length > 0) {
        text += `Completed:\n${task.completedRequirements.map((r) => `  ✓ ${sanitizeText(r)}`).join("\n")}\n\n`;
      }
      if (task.remainingRequirements && task.remainingRequirements.length > 0) {
        text += `Remaining:\n${task.remainingRequirements.map((r) => `  ⚠ ${sanitizeText(r)}`).join("\n")}\n\n`;
      }
      if (task.blockedReason) {
        text += `Reason:\n  ${sanitizeText(task.blockedReason)}\n\n`;
      }
      if (task.changeSet && task.changeSet.files.length > 0) {
        const fileWord =
          task.changeSet.stats.totalFiles === 1 ? "file" : "files";
        text += `Changes:\n  ${task.changeSet.stats.totalFiles} ${fileWord}\n  +${task.changeSet.stats.totalAdditions} -${task.changeSet.stats.totalDeletions}\n\n`;
        if (task.changeSet.areas.length > 0) {
          text += `Areas:\n${task.changeSet.areas.map((a) => `  ${a}`).join("\n")}\n\n`;
        }
      } else if (task.fileChanges && task.fileChanges.length > 0) {
        const changes = task.fileChanges.slice(0, maxFiles);
        text += `Changed:\n${changes.map((fc) => `  ${fc.path}\n  +${fc.additions} -${fc.deletions}`).join("\n\n")}\n\n`;
        if (task.fileChanges.length > maxFiles) {
          text += `  ... (+${task.fileChanges.length - maxFiles} more files)\n\n`;
        }
      } else if (task.completedFiles && task.completedFiles.length > 0) {
        const files = truncateList(task.completedFiles, maxFiles);
        text += `Changed:\n${files.map((f) => `  ${f}`).join("\n")}\n\n`;
      }
    } else if (task.status === "cancelled") {
      if (task.completedRequirements && task.completedRequirements.length > 0) {
        text += `Completed:\n${task.completedRequirements.map((r) => `  ✓ ${sanitizeText(r)}`).join("\n")}\n\n`;
      }
      if (task.remainingRequirements && task.remainingRequirements.length > 0) {
        text += `Remaining:\n${task.remainingRequirements.map((r) => `  ⚠ ${sanitizeText(r)}`).join("\n")}\n\n`;
      }
    }

    return text.trimEnd() + "\n";
  }

  public static formatCurrentTask(
    task: TaskCompletionSummary | null,
    currentRequest?: string
  ): string {
    if (
      !task ||
      task.status === "pending" ||
      task.status === ("idle" as unknown as TaskCompletionStatus)
    ) {
      return "Current Task\n\nNo active task.\n";
    }

    let text = "Current Task\n\n";
    text += `Status:\n  ${task.status}\n\n`;

    const req = task.request || currentRequest;
    if (req) {
      text += `Request:\n  ${sanitizeText(req)}\n\n`;
    }

    if (task.completedRequirements && task.completedRequirements.length > 0) {
      text += `Completed:\n${task.completedRequirements.map((r) => `  ✓ ${sanitizeText(r)}`).join("\n")}\n\n`;
    }

    if (task.remainingRequirements && task.remainingRequirements.length > 0) {
      text += `Remaining:\n${task.remainingRequirements.map((r) => `  ⚠ ${sanitizeText(r)}`).join("\n")}\n\n`;
    }

    if (task.blockedReason) {
      text += `Reason:\n  ${sanitizeText(task.blockedReason)}\n\n`;
    }

    return text.trimEnd() + "\n";
  }

  public static formatSessionStatus(info: {
    sessionId: string;
    workingDirectory: string;
    provider: string;
    model: string;
    taskCount: number;
    completedCount: number;
    blockedCount: number;
    currentStatus: string;
    lastChangeSet?: import("../changes/types.js").ChangeSet;
    gitStatus?: import("../git/types.js").GitStatus;
    lastAttribution?: import("../git/types.js").ChangeAttribution;
  }): string {
    let text = "FeCode\n\n";
    text += `Provider:\n  ${info.provider || "unknown"}\n\n`;
    text += `Model:\n  ${info.model || "unknown"}\n\n`;
    text += `Working directory:\n  ${info.workingDirectory}\n\n`;
    text += `Session:\n  ${info.sessionId}\n\n`;
    text += `Tasks:\n  ${info.taskCount}\n\n`;
    text += `Completed:\n  ${info.completedCount}\n\n`;
    text += `Blocked:\n  ${info.blockedCount}\n\n`;
    text += `Current task:\n  ${info.currentStatus}\n`;

    if (info.gitStatus) {
      if (info.gitStatus.isRepository) {
        const branchStr = info.gitStatus.branch || "unknown";
        const totalChanged = info.gitStatus.files.length;
        text += `\nGit:\n  ${branchStr}\n  ${totalChanged} changed file${totalChanged === 1 ? "" : "s"}\n`;
        if (info.lastAttribution) {
          text += `  ${info.lastAttribution.preExistingFiles.length} pre-existing\n`;
          text += `  ${info.lastAttribution.fecodeFiles.length} FeCode changes\n`;
        }
      } else {
        text += `\nGit:\n  Not a Git repository\n`;
      }
    }

    if (info.lastChangeSet && info.lastChangeSet.files.length > 0) {
      const fileWord =
        info.lastChangeSet.stats.totalFiles === 1 ? "file" : "files";
      text += `\nLast change:\n  ${info.lastChangeSet.stats.totalFiles} ${fileWord} · +${info.lastChangeSet.stats.totalAdditions} -${info.lastChangeSet.stats.totalDeletions}\n`;
      if (info.lastChangeSet.verification.attempted) {
        text += `\nVerification:\n`;
        for (const cmd of info.lastChangeSet.verification.commands) {
          text += `  ✓ ${sanitizeText(cmd)}\n`;
        }
        for (const cmd of info.lastChangeSet.verification.failedCommands) {
          text += `  ✗ ${sanitizeText(cmd)}\n`;
        }
      }
    }

    return text;
  }

  public static formatSessionsList(
    sessions: SessionSummaryWithLatestTask[]
  ): string {
    if (!sessions || sessions.length === 0) {
      return "Saved Sessions\n\nNo saved sessions found.\n";
    }

    let text = "Saved Sessions\n\n";

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      text += `${i + 1}. ${s.sessionId}\n`;
      text += `   ${s.workingDirectory}\n`;
      text += `   ${s.model}\n`;
      text += `   ${s.taskCount} task${s.taskCount === 1 ? "" : "s"}\n`;

      if (s.latestTaskSummary) {
        const sym = getTaskStatusSymbol(s.latestTaskSummary.status);
        const req = s.latestTaskSummary.request
          ? sanitizeText(s.latestTaskSummary.request.split("\n")[0])
          : "Task";
        text += `   ${sym} ${req}\n`;
      }

      if (s.updatedAt) {
        text += `   Last active: ${formatTimeRelative(s.updatedAt)}\n`;
      }

      text += "\n";
    }

    return text;
  }

  public static formatResumeSummary(session: PersistedSessionData): string {
    let text = "FeCode\n\n";
    text += "Resumed session\n\n";
    text += `Session:\n  ${session.sessionId}\n\n`;
    text += `Working directory:\n  ${session.workingDirectory}\n\n`;
    text += `Provider:\n  ${session.provider}\n\n`;
    text += `Model:\n  ${session.model}\n\n`;

    const tasks = session.completedTaskSummaries || [];
    if (tasks.length > 0) {
      text += "Previous tasks:\n";
      for (const t of tasks) {
        const sym = getTaskStatusSymbol(t.status);
        const req = t.request
          ? sanitizeText(t.request.split("\n")[0])
          : "Task";
        text += `  ${sym} ${req}\n`;
      }
      text += "\n";
    }

    text += `${session.taskCount} task${session.taskCount === 1 ? "" : "s"}\n`;
    return text;
  }
}
