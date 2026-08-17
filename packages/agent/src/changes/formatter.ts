import type { ChangeSet } from "./types.js";
import { sanitizeText } from "../session/sanitizer.js";

export class ChangeIntelligenceFormatter {
  public static formatChangeSummary(
    changeSet: ChangeSet,
    options: { maxFiles?: number } = {}
  ): string {
    if (!changeSet || changeSet.files.length === 0) {
      let emptyText = "Change Summary\n\nNo files changed.\n";
      if (changeSet?.verification?.attempted) {
        emptyText += "\nVerification:\n";
        for (const cmd of changeSet.verification.commands) {
          emptyText += `  ✓ ${sanitizeText(cmd)}\n`;
        }
        for (const cmd of changeSet.verification.failedCommands) {
          emptyText += `  ✗ ${sanitizeText(cmd)}\n`;
        }
      }
      return emptyText;
    }

    const maxFiles = options.maxFiles || 20;
    let text = "Change Summary\n\n";

    const totalCount = changeSet.stats.totalFiles;
    text += `Files:\n  ${totalCount} changed\n\n`;

    const displayedFiles = changeSet.files.slice(0, maxFiles);
    for (const f of displayedFiles) {
      const opCode =
        f.operation === "added" ? "A" : f.operation === "deleted" ? "D" : "M";
      const cleanPath = f.path.replace(/\\/g, "/");
      const stat = `+${f.additions} -${f.deletions}`;
      text += `  ${opCode} ${cleanPath.padEnd(36)} ${stat}\n`;
    }

    if (changeSet.files.length > maxFiles) {
      text += `  ... (+${changeSet.files.length - maxFiles} more files)\n`;
    }

    text += `\nLines:\n  +${changeSet.stats.totalAdditions} -${changeSet.stats.totalDeletions}\n`;

    if (changeSet.areas.length > 0) {
      text += `\nAreas:\n`;
      for (const area of changeSet.areas) {
        text += `  ${area}\n`;
      }
    }

    if (changeSet.verification.attempted) {
      text += `\nVerification:\n`;
      for (const cmd of changeSet.verification.commands) {
        text += `  ✓ ${sanitizeText(cmd)}\n`;
      }
      for (const cmd of changeSet.verification.failedCommands) {
        text += `  ✗ ${sanitizeText(cmd)}\n`;
      }

      text += `\nStatus:\n  ${changeSet.verification.passed ? "Verified" : "Verification failed"}\n`;
    } else {
      text += `\nStatus:\n  Completed without verification\n`;
    }

    return text;
  }

  public static formatConciseHistoryImpact(changeSet: ChangeSet): string {
    if (!changeSet || changeSet.files.length === 0) {
      return "";
    }

    const fileWord = changeSet.stats.totalFiles === 1 ? "file" : "files";
    const line1 = `${changeSet.stats.totalFiles} ${fileWord} · +${changeSet.stats.totalAdditions} -${changeSet.stats.totalDeletions}`;
    const areas = changeSet.areas.length > 0 ? changeSet.areas.join(", ") : "";

    let text = `   ${line1}\n`;
    if (areas) {
      text += `   ${areas}\n`;
    }
    if (
      changeSet.verification.attempted &&
      !changeSet.verification.passed &&
      changeSet.verification.failedCommands.length > 0
    ) {
      text += `   Verification failed\n`;
    }

    return text;
  }

  public static formatTaskDetailImpact(changeSet: ChangeSet): string {
    if (!changeSet || changeSet.files.length === 0) {
      return "";
    }

    const fileWord = changeSet.stats.totalFiles === 1 ? "file" : "files";
    let text = `Changes:\n  ${changeSet.stats.totalFiles} ${fileWord}\n  +${changeSet.stats.totalAdditions} -${changeSet.stats.totalDeletions}\n\n`;

    if (changeSet.areas.length > 0) {
      text += `Areas:\n${changeSet.areas.map((a) => `  ${a}`).join("\n")}\n\n`;
    }

    if (changeSet.verification.attempted) {
      text += `Verification:\n`;
      for (const cmd of changeSet.verification.commands) {
        text += `  ✓ ${sanitizeText(cmd)}\n`;
      }
      for (const cmd of changeSet.verification.failedCommands) {
        text += `  ✗ ${sanitizeText(cmd)}\n`;
      }
      text += "\n";
    }

    return text;
  }
}
