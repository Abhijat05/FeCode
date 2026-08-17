import type {
  ChangeSet,
  ChangeSetCommand,
  ChangeSetFile,
  ChangeSetOperation,
  ChangeSetStats,
  VerificationSummary
} from "./types.js";
import { classifyArea, classifyCategory } from "./classifier.js";

function resolveAggregatedOperation(
  prev: ChangeSetOperation,
  next: ChangeSetOperation
): ChangeSetOperation {
  if (prev === "added") {
    if (next === "deleted") return "deleted";
    return "added";
  }
  if (prev === "modified") {
    if (next === "deleted") return "deleted";
    return "modified";
  }
  if (prev === "deleted") {
    if (next === "added") return "modified";
    return "deleted";
  }
  return next;
}

export class ChangeSetBuilder {
  private filesMap: Map<string, ChangeSetFile> = new Map();
  private commandsList: ChangeSetCommand[] = [];

  public recordFileChange(file: ChangeSetFile): void {
    if (!file || !file.path) return;
    const cleanPath = file.path.trim().replace(/\\/g, "/");

    const existing = this.filesMap.get(cleanPath);
    if (existing) {
      existing.additions += file.additions;
      existing.deletions += file.deletions;
      existing.operation = resolveAggregatedOperation(
        existing.operation,
        file.operation
      );
    } else {
      this.filesMap.set(cleanPath, {
        path: cleanPath,
        operation: file.operation,
        additions: file.additions,
        deletions: file.deletions
      });
    }
  }

  public recordCommand(cmd: ChangeSetCommand): void {
    if (!cmd || !cmd.command) return;
    this.commandsList.push({
      command: cmd.command.trim(),
      exitCode: cmd.exitCode,
      timedOut: Boolean(cmd.timedOut),
      succeeded: Boolean(cmd.succeeded)
    });
  }

  public build(taskId?: string): ChangeSet {
    // Sort files deterministically (alphabetically)
    const files = Array.from(this.filesMap.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    let totalAdditions = 0;
    let totalDeletions = 0;
    let addedFiles = 0;
    let modifiedFiles = 0;
    let deletedFiles = 0;

    const areaSet = new Set<string>();
    const categorySet = new Set<string>();

    for (const f of files) {
      totalAdditions += f.additions;
      totalDeletions += f.deletions;
      if (f.operation === "added") addedFiles++;
      else if (f.operation === "deleted") deletedFiles++;
      else modifiedFiles++;

      areaSet.add(classifyArea(f.path));
      categorySet.add(classifyCategory(f.path));
    }

    const stats: ChangeSetStats = {
      totalFiles: files.length,
      addedFiles,
      modifiedFiles,
      deletedFiles,
      totalAdditions,
      totalDeletions
    };

    const succeededCommands = new Set<string>();
    const failedCommands = new Set<string>();

    for (const cmd of this.commandsList) {
      if (cmd.succeeded) {
        succeededCommands.add(cmd.command);
      } else {
        failedCommands.add(cmd.command);
      }
    }

    const attempted = this.commandsList.length > 0;
    const verifiedList = Array.from(succeededCommands).sort();
    const failedList = Array.from(failedCommands).sort();
    const passed = attempted && failedList.length === 0 && verifiedList.length > 0;

    const verification: VerificationSummary = {
      attempted,
      passed,
      commands: verifiedList,
      failedCommands: failedList
    };

    return {
      taskId,
      files,
      stats,
      areas: Array.from(areaSet).sort(),
      categories: Array.from(categorySet).sort(),
      commands: [...this.commandsList],
      verification
    };
  }

  public reset(): void {
    this.filesMap.clear();
    this.commandsList = [];
  }
}
