import type { DurableRunRecord, ResumePreparation } from "./types.js";
import { formatRunDiagnostics } from "../diagnostics/formatter.js";

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export class RunHistoryFormatter {
  public static formatRunsList(runs: DurableRunRecord[]): string {
    if (!runs || runs.length === 0) {
      return "No historical runs found for this project.\n";
    }

    const lines: string[] = ["Persisted Runs:", ""];
    runs.forEach((run, idx) => {
      const num = idx + 1;
      const statusTag =
        run.finalStatus === "completed"
          ? "✓ completed"
          : run.finalStatus === "cancelled"
            ? "⊘ cancelled"
            : run.finalStatus === "interrupted"
              ? "⚠ interrupted"
              : "✗ failed";

      const timeAgo = formatRelativeTime(run.startedAt);
      const durationStr =
        run.durationMs !== undefined
          ? `${(run.durationMs / 1000).toFixed(1)}s`
          : "in progress";

      lines.push(`${num}. ${run.runId}`);
      lines.push(`   Status:   ${statusTag}`);
      lines.push(`   Time:     ${timeAgo} (${durationStr})`);
      lines.push(`   Project:  ${run.projectId}`);
      if (run.parentRunId) {
        lines.push(`   Resumed:  from ${run.parentRunId}`);
      }
      lines.push(`   Request:  ${run.userRequestSummary.slice(0, 80)}`);
      if (run.failureReason) {
        lines.push(`   Failure:  ${run.failureReason.slice(0, 80)}`);
      }
      lines.push("");
    });

    lines.push("Use `/run <id>` to inspect details or `/resume <id>` to resume an incomplete task.");
    return lines.join("\n");
  }

  public static formatRunDetail(run: DurableRunRecord): string {
    const diagText = formatRunDiagnostics(run);
    const extraLines: string[] = [];
    extraLines.push(`Project:   ${run.projectId}`);
    if (run.parentRunId) {
      extraLines.push(`ParentRun: ${run.parentRunId}`);
    }
    if (run.workspaceFingerprint) {
      if (run.workspaceFingerprint.gitBranch) {
        extraLines.push(`Branch:    ${run.workspaceFingerprint.gitBranch}`);
      }
      if (run.workspaceFingerprint.isGitDirty !== undefined) {
        extraLines.push(`Dirty:     ${run.workspaceFingerprint.isGitDirty ? "yes" : "no"}`);
      }
    }

    return `${diagText}\n\n${extraLines.join("\n")}`;
  }

  public static formatResumePrompt(prep: ResumePreparation): string {
    const lines: string[] = ["Resume Task Request:", ""];
    const run = prep.originalRun;

    lines.push(`  Original Run ID: ${run.runId}`);
    lines.push(`  Original Status: ${run.finalStatus}`);
    lines.push(`  Original Time:   ${formatRelativeTime(run.startedAt)}`);
    lines.push(`  Project:         ${run.projectId}`);
    lines.push(`  Resume Depth:    ${prep.resumeDepth}`);
    lines.push(`  Request:         ${run.userRequestSummary}`);

    if (run.failureReason) {
      lines.push(`  Failure Reason:  ${run.failureReason}`);
    } else if (run.cancellationReason) {
      lines.push(`  Cancel Reason:   ${run.cancellationReason}`);
    }

    lines.push("");
    lines.push(`  New Run ID:      ${prep.newRunId}`);
    lines.push(`  Parent Run ID:   ${prep.suggestedParentRunId}`);
    lines.push(`  Reassessed Risk: ${prep.reassessedRisk.level}`);
    if (prep.reassessedSkills.length > 0) {
      lines.push(`  Active Skills:   ${prep.reassessedSkills.join(", ")}`);
    }

    if (prep.workspaceChanged) {
      lines.push("");
      lines.push("  ⚠ Workspace Changes Detected:");
      prep.workspaceDiffReasons.forEach((r) => {
        lines.push(`    - ${r}`);
      });
    }

    lines.push("");
    lines.push("Resume Safety Summary:");
    lines.push("  • A fresh execution identity will be started without modifying the original run record.");
    lines.push("  • Previous permissions and checkpoint approvals do NOT carry over; fresh approval will be requested.");
    lines.push("  • Previous commands and tool calls will NOT be replayed.");
    lines.push("  • The agent will inspect current workspace files using read tools before taking action.");

    return lines.join("\n");
  }
}
