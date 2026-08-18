import type {
  Checkpoint,
  CheckpointComparison,
  RiskAssessment
} from "./types.js";
import { sanitizeText } from "../session/sanitizer.js";

function formatRelativeTime(dateStr: string): string {
  try {
    const time = new Date(dateStr).getTime();
    if (isNaN(time)) return "unknown";
    const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));

    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  } catch {
    return "unknown";
  }
}

export class CheckpointFormatter {
  public static formatRiskPrompt(assessment: RiskAssessment): string {
    let text = "⚠ Risky task detected\n\nReasons:\n";
    for (const r of assessment.reasons) {
      text += `  • ${sanitizeText(r)}\n`;
    }
    text += "\nFeCode can create a recovery checkpoint before continuing.\n\nCreate checkpoint? [y/N]";
    return text;
  }

  public static formatCheckpointCreated(checkpoint: Checkpoint): string {
    let text = "✓ Checkpoint created\n\n";
    text += `ID:\n  ${checkpoint.id}\n\n`;
    if (checkpoint.branch) {
      text += `Branch:\n  ${checkpoint.branch}\n\n`;
    }
    text += `Files captured:\n  ${checkpoint.totalFiles}\n`;
    return text;
  }

  public static formatCheckpointDetail(checkpoint: Checkpoint): string {
    let text = `Checkpoint:\n  ${checkpoint.id}\n\n`;
    text += `Created:\n  ${new Date(checkpoint.createdAt).toLocaleString()}\n\n`;
    if (checkpoint.branch) {
      text += `Branch:\n  ${checkpoint.branch}\n\n`;
    }
    text += `Files:\n  ${checkpoint.totalFiles}\n\n`;
    text += `Status:\n  ${checkpoint.status === "ready" ? "Ready" : checkpoint.status === "invalid" ? "Invalid" : "Expired"}\n`;
    return text;
  }

  public static formatCheckpointsList(checkpoints: Checkpoint[]): string {
    if (!checkpoints || checkpoints.length === 0) {
      return "Checkpoints\n\nNo checkpoints found.\n";
    }

    let text = "Checkpoints\n\n";
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const timeStr = formatRelativeTime(cp.createdAt);
      text += `${i + 1}. ${cp.id}\n`;
      if (cp.branch) {
        text += `   ${cp.branch}\n`;
      }
      text += `   ${cp.totalFiles} file${cp.totalFiles === 1 ? "" : "s"}\n`;
      text += `   ${timeStr}\n\n`;
    }

    return text.trimEnd() + "\n";
  }

  public static formatCheckpointComparison(
    comparison: CheckpointComparison
  ): string {
    let text = `Checkpoint:\n  ${comparison.checkpointId}\n\n`;

    if (comparison.files.length === 0) {
      text += "Since checkpoint:\n  No changes detected.\n";
      return text;
    }

    text += "Since checkpoint:\n\n";
    for (const f of comparison.files) {
      const opCode =
        f.operation === "added" ? "A" : f.operation === "deleted" ? "D" : "M";
      const stat = `+${f.additions} -${f.deletions}`;
      text += `  ${opCode} ${f.path.padEnd(32)} ${stat}\n`;
    }

    text += `\nTotal:\n  +${comparison.totalAdditions} -${comparison.totalDeletions}\n`;
    return text;
  }
}
