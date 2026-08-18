import type { ChangeAttribution, GitStatus } from "./types.js";
import { sanitizeText } from "../session/sanitizer.js";

export class GitStatusFormatter {
  public static formatGitStatus(
    status: GitStatus,
    attribution?: ChangeAttribution
  ): string {
    if (!status.gitAvailable) {
      return "Git\n\nGit executable not available\n";
    }

    if (!status.isRepository) {
      return "Git\n\nNot a Git repository\n";
    }

    let text = "Git\n\n";

    if (status.root) {
      text += `Repository:\n  ${sanitizeText(status.root)}\n\n`;
    }

    text += `Branch:\n  ${status.branch || "unknown"}\n\n`;

    const totalChanged = status.files.length;
    text += `Status:\n  ${totalChanged} changed file${totalChanged === 1 ? "" : "s"}\n\n`;

    if (attribution) {
      const preCount = attribution.preExistingFiles.length;
      text += `Pre-existing:\n  ${preCount} file${preCount === 1 ? "" : "s"}\n\n`;

      const feCount = attribution.fecodeFiles.length;
      text += `Current task:\n  ${feCount} FeCode change${feCount === 1 ? "" : "s"}\n\n`;
    }

    const untrackedCount = status.files.filter(
      (f) => f.indexStatus === "?" || f.worktreeStatus === "?"
    ).length;
    text += `Untracked:\n  ${untrackedCount} file${untrackedCount === 1 ? "" : "s"}\n\n`;

    const conflictCount = status.files.filter(
      (f) =>
        f.indexStatus === "U" ||
        f.worktreeStatus === "U" ||
        (f.indexStatus === "A" && f.worktreeStatus === "A") ||
        (f.indexStatus === "D" && f.worktreeStatus === "D")
    ).length;
    text += `Conflicts:\n  ${conflictCount}\n`;

    return text;
  }

  public static formatTaskGitAttribution(
    branch: string | null,
    attribution: ChangeAttribution,
    fecodeStatsSummary?: string
  ): string {
    let text = "";

    if (branch) {
      text += `\nGit:\n  ${branch}\n`;
    }

    const preCount = attribution.preExistingFiles.length;
    text += `\nPre-existing:\n  ${preCount} file${preCount === 1 ? "" : "s"}\n`;

    const feCount = attribution.fecodeFiles.length;
    const feStats = fecodeStatsSummary ? ` · ${fecodeStatsSummary}` : "";
    text += `\nFeCode changes:\n  ${feCount} file${feCount === 1 ? "" : "s"}${feStats}\n`;

    const unCount = attribution.unattributedFiles.length;
    text += `\nUnattributed:\n  ${unCount} file${unCount === 1 ? "" : "s"}\n`;

    if (attribution.preservedUserFiles.length > 0) {
      text += `\nUser changes preserved:\n`;
      for (const f of attribution.preservedUserFiles) {
        text += `  ✓ ${sanitizeText(f)}\n`;
      }
    }

    return text;
  }
}
