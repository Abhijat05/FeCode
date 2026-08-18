import type { GitFileStatus } from "./types.js";

export interface ParsedGitStatus {
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  files: GitFileStatus[];
  hasConflicts: boolean;
}

/**
 * Parses the output of `git status --porcelain=v1 -b` into a structured format.
 */
export function parseGitStatusPorcelain(output: string): ParsedGitStatus {
  let branch: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  const files: GitFileStatus[] = [];
  let hasConflicts = false;

  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    if (!line || !line.trim()) continue;

    // Header line: ## branch...upstream [ahead N, behind M]
    if (line.startsWith("##")) {
      const headerContent = line.slice(2).trim();

      if (headerContent.includes("(no branch)") || headerContent.startsWith("HEAD (no branch)")) {
        branch = "HEAD detached";
      } else if (headerContent.startsWith("No commits yet on ") || headerContent.startsWith("Initial commit on ")) {
        branch = headerContent.replace(/^(No commits yet on |Initial commit on )/, "").trim();
      } else {
        // e.g. main...origin/main [ahead 1, behind 2] or main
        const branchPart = headerContent.split("...")[0].trim().split(" ")[0].trim();
        branch = branchPart || null;

        // Parse ahead/behind
        const aheadMatch = headerContent.match(/ahead\s+(\d+)/);
        if (aheadMatch) {
          ahead = parseInt(aheadMatch[1], 10);
        }
        const behindMatch = headerContent.match(/behind\s+(\d+)/);
        if (behindMatch) {
          behind = parseInt(behindMatch[1], 10);
        }
      }
      continue;
    }

    // File status line: XY path [-> orig]
    if (line.length >= 3) {
      const indexStatus = line[0];
      const worktreeStatus = line[1];
      const rest = line.slice(3).trim();

      const isConflict =
        indexStatus === "U" ||
        worktreeStatus === "U" ||
        (indexStatus === "A" && worktreeStatus === "A") ||
        (indexStatus === "D" && worktreeStatus === "D");

      if (isConflict) {
        hasConflicts = true;
      }

      let filePath = rest;
      let origPath: string | undefined;

      if (rest.includes(" -> ")) {
        const parts = rest.split(" -> ");
        origPath = parts[0].trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
        filePath = parts[1].trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
      } else {
        filePath = filePath.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
      }

      files.push({
        path: filePath,
        indexStatus,
        worktreeStatus,
        origPath
      });
    }
  }

  // Sort files deterministically
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    branch,
    ahead,
    behind,
    files,
    hasConflicts
  };
}
