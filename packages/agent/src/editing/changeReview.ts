import { sanitizeText } from "../session/sanitizer.js";

export type ChangeOperation = "added" | "modified" | "deleted";

export interface ChangeReviewFile {
  path: string;
  operation: ChangeOperation;
  additions: number;
  deletions: number;
  diff?: string;
  isNoOp?: boolean;
}

export interface ChangeReview {
  files: ChangeReviewFile[];
  totalAddedLines: number;
  totalRemovedLines: number;
  truncated: boolean;
}

export function calculateDiffStats(diff: string): {
  additions: number;
  deletions: number;
} {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;

  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

export function createChangeReview(
  files: ChangeReviewFile[],
  options: { maxDisplayLines?: number } = {}
): ChangeReview {
  let totalAddedLines = 0;
  let totalRemovedLines = 0;
  let truncated = false;
  const maxLines = options.maxDisplayLines || 100;

  // Sort files deterministically: alphabetically by path
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  let totalDiffLines = 0;
  for (const f of sortedFiles) {
    totalAddedLines += f.additions;
    totalRemovedLines += f.deletions;
    if (f.diff) {
      totalDiffLines += f.diff.split("\n").length;
    }
  }

  if (totalDiffLines > maxLines) {
    truncated = true;
  }

  return {
    files: sortedFiles,
    totalAddedLines,
    totalRemovedLines,
    truncated
  };
}

export class ChangeReviewFormatter {
  public static format(
    reviewOrFile: ChangeReview | ChangeReviewFile,
    options: { maxLines?: number } = {}
  ): string {
    if ("files" in reviewOrFile) {
      if (reviewOrFile.files.length === 1) {
        return this.formatSingleFileReview(reviewOrFile.files[0], options);
      }
      return this.formatMultiFileReview(reviewOrFile, options);
    }
    return this.formatSingleFileReview(reviewOrFile, options);
  }

  public static formatSingleFileReview(
    file: ChangeReviewFile,
    options: { maxLines?: number } = {}
  ): string {
    const maxLines = options.maxLines || 60;
    const cleanPath = file.path.replace(/\\/g, "/");

    let header = "";
    if (file.operation === "added") {
      header = "⚠ FeCode wants to create a file";
    } else if (file.operation === "deleted") {
      header = "⚠ FeCode wants to delete a file";
    } else {
      header = "⚠ FeCode wants to modify a file";
    }

    let text = `${header}\n\n`;
    text += `File:\n  ${cleanPath}\n\n`;
    text += `Change:\n  +${file.additions} -${file.deletions}\n`;

    if (file.operation !== "deleted" && file.diff) {
      const sanitizedDiff = sanitizeText(file.diff);
      const diffLines = sanitizedDiff.split("\n");
      let displayDiff = sanitizedDiff;

      if (diffLines.length > maxLines) {
        const half = Math.floor(maxLines / 2);
        const top = diffLines.slice(0, half);
        const bottom = diffLines.slice(diffLines.length - half);
        const omitted = diffLines.length - maxLines;
        displayDiff = [
          ...top,
          `... (diff display truncated; ${omitted} lines omitted) ...`,
          ...bottom
        ].join("\n");
      }

      text += `\nDiff:\n${displayDiff}\n`;
    }

    return text;
  }

  public static formatMultiFileReview(
    review: ChangeReview,
    options: { maxLines?: number } = {}
  ): string {
    const maxLines = options.maxLines || 100;
    const count = review.files.length;
    let text = `⚠ FeCode wants to modify ${count} files\n\n`;

    for (const file of review.files) {
      const opCode =
        file.operation === "added"
          ? "A"
          : file.operation === "deleted"
            ? "D"
            : "M";
      const cleanPath = file.path.replace(/\\/g, "/");
      const stat = `+${file.additions} -${file.deletions}`;
      text += `  ${opCode} ${cleanPath.padEnd(36)} ${stat}\n`;
    }

    text += `\nTotal:\n  +${review.totalAddedLines} -${review.totalRemovedLines}\n`;

    // Render aggregated diffs if available
    const diffParts: string[] = [];
    for (const file of review.files) {
      if (file.diff) {
        diffParts.push(sanitizeText(file.diff));
      }
    }

    if (diffParts.length > 0) {
      const combinedDiff = diffParts.join("\n\n");
      const diffLines = combinedDiff.split("\n");

      if (diffLines.length > maxLines) {
        const top = diffLines.slice(0, maxLines);
        text += `\nDiff is too large to display completely.\nShowing first ${maxLines} lines.\n\n`;
        text += `${top.join("\n")}\n`;
      } else {
        text += `\nDiff:\n${combinedDiff}\n`;
      }
    }

    return text;
  }
}
