import type {
  RecoveryPreview,
  RecoveryRecord,
  RecoveryResult
} from "./types.js";
import { sanitizeText } from "../session/sanitizer.js";

export class RecoveryFormatter {
  public static formatRecoveryPreview(preview: RecoveryPreview): string {
    let text = "Recovery Preview\n\n";
    text += `Checkpoint:\n  ${preview.checkpointId}\n\n`;

    if (preview.currentBranch) {
      text += `Current branch:\n  ${preview.currentBranch}\n\n`;
    }
    if (preview.checkpointBranch) {
      text += `Checkpoint branch:\n  ${preview.checkpointBranch}\n\n`;
    }

    if (!preview.safe) {
      text += "⚠ Recovery blocked\n\n";
      for (const r of preview.reasons) {
        text += `Reason:\n  ${sanitizeText(r)}\n\n`;
      }
      for (const c of preview.conflicts) {
        text += `Conflict in ${c.path}:\n  ${sanitizeText(c.reason)}\n\n`;
      }
      text += "No files were modified.\n";
      return text;
    }

    if (preview.files.length === 0) {
      text += "Changes since checkpoint:\n  No changes detected.\n\n";
    } else {
      text += "Changes since checkpoint:\n\n";
      for (const f of preview.files) {
        const opCode =
          f.operation === "delete" ? "A" : f.operation === "restore" ? "M" : "R";
        const stat = `+${f.additions} -${f.deletions}`;
        text += `  ${opCode} ${f.path.padEnd(32)} ${stat}\n`;
      }
      text += "\n";
    }

    text += `Potentially affected:\n  ${preview.totalFiles} file${preview.totalFiles === 1 ? "" : "s"}\n\n`;

    if (preview.preExistingFiles.length > 0) {
      text += `Pre-existing changes:\n  ${preview.preExistingFiles.length} file${preview.preExistingFiles.length === 1 ? "" : "s"}\n\n`;
    }

    text += "Recovery will:\n  restore checkpoint state for affected FeCode changes\n\n";
    text += "Recovery will NOT:\n  overwrite unrelated pre-existing changes\n";

    return text;
  }

  public static formatRecoveryPrompt(preview: RecoveryPreview): string {
    let totalAdds = 0;
    let totalDels = 0;
    for (const f of preview.files) {
      totalAdds += f.additions;
      totalDels += f.deletions;
    }

    let text = "⚠ FeCode wants to restore a checkpoint\n\n";
    text += `Checkpoint:\n  ${preview.checkpointId}\n\n`;
    text += `Affected files:\n  ${preview.totalFiles}\n\n`;
    text += `Changes to revert:\n  +${totalAdds} -${totalDels}\n\n`;
    text += `Potential conflicts:\n  ${preview.conflicts.length}\n\n`;
    text += "This operation may modify files on disk.\n\n";
    text += "Proceed? [y/N]";
    return text;
  }

  public static formatRecoveryResult(result: RecoveryResult): string {
    if (result.status === "completed") {
      let text = "✓ Recovery completed\n\n";
      text += `Checkpoint:\n  ${result.checkpointId}\n\n`;
      text += `Recovered:\n  ${result.recoveredFiles.length} file${result.recoveredFiles.length === 1 ? "" : "s"}\n\n`;
      if (result.preservedFiles.length > 0) {
        text += `Preserved:\n  ${result.preservedFiles.length} pre-existing file${result.preservedFiles.length === 1 ? "" : "s"}\n\n`;
      }
      text += "Conflicts:\n  0\n\n";
      text += "Repository:\n  clean relative to checkpoint\n";
      return text;
    }

    if (result.status === "blocked") {
      let text = "✗ Recovery blocked\n\n";
      text += `Checkpoint:\n  ${result.checkpointId}\n\n`;
      if (result.conflicts.length > 0) {
        text += `Conflicts:\n  ${result.conflicts.length}\n\n`;
        for (const c of result.conflicts) {
          text += `  • ${c.path}: ${sanitizeText(c.reason)}\n`;
        }
        text += "\n";
      }
      if (result.error) {
        text += `Reason:\n  ${sanitizeText(result.error)}\n\n`;
      }
      text += "No files were modified.\n";
      return text;
    }

    if (result.status === "cancelled") {
      return "⚠ Recovery cancelled\n\nNo files were modified.\n";
    }

    let text = "✗ Recovery failed\n\n";
    text += `Checkpoint:\n  ${result.checkpointId}\n\n`;
    if (result.error) {
      text += `Error:\n  ${sanitizeText(result.error)}\n\n`;
    }
    if (result.emergencySnapshotPath) {
      text += `Emergency snapshot preserved at:\n  ${result.emergencySnapshotPath}\n\n`;
    }
    text += "Attempted pre-recovery rollback.\n";
    return text;
  }

  public static formatRecoveryStatus(
    record: RecoveryRecord | null,
    lastCheckpointId?: string
  ): string {
    let text = "Recovery\n\n";
    if (lastCheckpointId) {
      text += `Last checkpoint:\n  ${lastCheckpointId}\n\n`;
    }

    if (!record) {
      text += "Last recovery:\n  No recovery operations recorded.\n";
      return text;
    }

    const statusTitle =
      record.status === "completed"
        ? "Completed"
        : record.status === "blocked"
          ? "Blocked"
          : record.status === "cancelled"
            ? "Cancelled"
            : "Failed";

    text += `Last recovery:\n  ${statusTitle}\n\n`;

    if (record.status === "completed") {
      text += `Recovered:\n  ${record.affectedFiles.length} file${record.affectedFiles.length === 1 ? "" : "s"}\n`;
    } else if (record.conflicts.length > 0) {
      text += `Reason:\n  ${sanitizeText(record.conflicts.join("; "))}\n`;
    }

    return text.trimEnd() + "\n";
  }
}
