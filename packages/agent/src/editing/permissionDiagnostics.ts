import * as fs from "fs/promises";
import * as path from "path";
import type { Stats } from "fs";

/**
 * Checks if file or directory stats indicate a read-only mode.
 * On POSIX, checks if all write bits (owner, group, other: 0o222) are cleared.
 * On Windows, Node clears all write bits when the Windows read-only attribute is set.
 */
export function isReadOnlyStat(stats: { mode: number }): boolean {
  return (stats.mode & 0o222) === 0;
}

/**
 * Returns a diagnostic message with actionable remediation commands
 * when a write or edit operation is denied due to file or directory permissions.
 */
export async function getWritePermissionDiagnostic(
  targetPath: string,
  displayPath?: string,
  knownStats?: Stats | { mode: number }
): Promise<string> {
  const relOrDisplay = displayPath || targetPath;

  // 1. Check if the target file itself is read-only
  try {
    const stats = knownStats || (await fs.stat(targetPath));
    if (isReadOnlyStat(stats)) {
      const fixCmd =
        process.platform === "win32"
          ? `attrib -r "${relOrDisplay}"`
          : `chmod +w "${relOrDisplay}"`;
      return `Permission denied: file is marked read-only on disk (${relOrDisplay}). Advise user to remove read-only protection: '${fixCmd}'.`;
    }
  } catch {
    // If target doesn't exist yet, proceed to check parent directory
  }

  // 2. Check if the parent directory is read-only
  const parentDir = path.dirname(targetPath);
  try {
    const parentStats = await fs.stat(parentDir);
    if (isReadOnlyStat(parentStats)) {
      const parentDisplay = displayPath ? path.dirname(displayPath) : parentDir;
      const fixCmd =
        process.platform === "win32"
          ? `attrib -r "${parentDisplay}"`
          : `chmod +w "${parentDisplay}"`;
      return `Permission denied: parent directory is marked read-only on disk (${parentDisplay}). Advise user to grant write access: '${fixCmd}'.`;
    }
  } catch {
    // Ignore stat failures on parent
  }

  // 3. Fallback generic permission denied message
  return `Permission denied writing file: ${relOrDisplay}. Ensure the current user has write access to the file and its enclosing directory.`;
}
