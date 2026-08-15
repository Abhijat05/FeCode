import type { ExplorationResult } from "./types.js";

export class RepositoryExplorationFormatter {
  public format(result: ExplorationResult): string {
    if (!result || result.relevantFiles.length === 0) {
      return "";
    }

    const lines = ["## Repository Exploration", "\nRelevant files:"];
    for (const file of result.relevantFiles) {
      lines.push(`- ${file.path} — ${file.reason}`);
    }

    if (result.directories.length > 0) {
      lines.push("\nDirectories:");
      for (const dir of result.directories) {
        lines.push(`- ${dir}`);
      }
    }

    return lines.join("\n");
  }
}
