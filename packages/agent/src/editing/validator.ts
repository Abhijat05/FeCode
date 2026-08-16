import * as fs from "fs/promises";
import * as path from "path";
import type { SafeEditOptions, ValidatedEdit } from "./types.js";
import { resolveSafePath } from "../tools/pathUtils.js";
import { createUnifiedDiff } from "../tools/diffUtils.js";
import { createContentHash } from "./hashUtils.js";

function countOccurrences(str: string, searchStr: string): number {
  if (!searchStr) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(searchStr, pos)) !== -1) {
    count++;
    pos += searchStr.length;
  }
  return count;
}

export function isSecretFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  if (
    basename.startsWith(".env") ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename === "id_rsa" ||
    basename === "id_dsa" ||
    basename === "id_ed25519" ||
    basename === "credentials" ||
    basename === "secrets.json"
  ) {
    return true;
  }
  return false;
}

export class SafeEditValidator {
  public async validateEdit(
    filePath: string,
    oldText: string,
    newText: string,
    cwd: string,
    options: SafeEditOptions = {}
  ): Promise<ValidatedEdit> {
    if (options.signal?.aborted) {
      return {
        path: filePath,
        targetPath: "",
        displayPath: filePath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: "Operation was cancelled.",
          code: "CANCELLED"
        }
      };
    }

    const pathRes = resolveSafePath(cwd, filePath);
    if ("error" in pathRes) {
      return {
        path: filePath,
        targetPath: "",
        displayPath: filePath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: pathRes.error.message,
          code: "PATH_OUT_OF_BOUNDS"
        }
      };
    }

    const { targetPath, displayPath } = pathRes;

    if (isSecretFile(displayPath)) {
      return {
        path: filePath,
        targetPath,
        displayPath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: `Editing secret files is prohibited (${displayPath}).`,
          code: "SECRET_FILE"
        }
      };
    }

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent: "",
          proposedContent: "",
          diff: "",
          contentHash: "",
          valid: false,
          error: {
            message: `Target path is a directory: ${displayPath}`,
            code: "EDIT_INVALID"
          }
        };
      }

      const originalContent = await fs.readFile(targetPath, "utf-8");
      const currentHash = createContentHash(originalContent);

      if (options.expectedHash && currentHash !== options.expectedHash) {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent,
          proposedContent: "",
          diff: "",
          contentHash: currentHash,
          valid: false,
          error: {
            message: `File content has changed since context was selected (${displayPath}). Expected hash: ${options.expectedHash.substring(0, 8)}, current hash: ${currentHash.substring(0, 8)}.`,
            code: "EDIT_CONFLICT"
          }
        };
      }

      const matchCount = countOccurrences(originalContent, oldText);
      if (matchCount === 0) {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent,
          proposedContent: "",
          diff: "",
          contentHash: currentHash,
          valid: false,
          error: {
            message: `Could not find exact match for oldText in ${displayPath}. Ensure oldText matches target content exactly.`,
            code: "EDIT_INVALID"
          }
        };
      }

      if (matchCount > 1) {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent,
          proposedContent: "",
          diff: "",
          contentHash: currentHash,
          valid: false,
          error: {
            message: `Found multiple (${matchCount}) occurrences of oldText in ${displayPath}. Specify more surrounding context to uniquely identify the edit.`,
            code: "EDIT_INVALID"
          }
        };
      }

      const proposedContent = originalContent.replace(oldText, newText);
      const diff = createUnifiedDiff(displayPath, originalContent, proposedContent);

      return {
        path: filePath,
        targetPath,
        displayPath,
        originalContent,
        proposedContent,
        diff,
        contentHash: currentHash,
        valid: true
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      return {
        path: filePath,
        targetPath,
        displayPath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: error.message || "Failed to inspect target file.",
          code: "EDIT_INVALID"
        }
      };
    }
  }

  public async validateWrite(
    filePath: string,
    content: string,
    cwd: string,
    options: SafeEditOptions = {}
  ): Promise<ValidatedEdit> {
    if (options.signal?.aborted) {
      return {
        path: filePath,
        targetPath: "",
        displayPath: filePath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: "Operation was cancelled.",
          code: "CANCELLED"
        }
      };
    }

    const pathRes = resolveSafePath(cwd, filePath);
    if ("error" in pathRes) {
      return {
        path: filePath,
        targetPath: "",
        displayPath: filePath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: pathRes.error.message,
          code: "PATH_OUT_OF_BOUNDS"
        }
      };
    }

    const { targetPath, displayPath } = pathRes;

    if (isSecretFile(displayPath)) {
      return {
        path: filePath,
        targetPath,
        displayPath,
        originalContent: "",
        proposedContent: "",
        diff: "",
        contentHash: "",
        valid: false,
        error: {
          message: `Writing to secret files is prohibited (${displayPath}).`,
          code: "SECRET_FILE"
        }
      };
    }

    let originalContent = "";
    let fileExists = false;

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent: "",
          proposedContent: "",
          diff: "",
          contentHash: "",
          valid: false,
          error: {
            message: `Cannot write to path because it is a directory: ${displayPath}`,
            code: "EDIT_INVALID"
          }
        };
      }
      fileExists = true;
      originalContent = await fs.readFile(targetPath, "utf-8");
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        return {
          path: filePath,
          targetPath,
          displayPath,
          originalContent: "",
          proposedContent: "",
          diff: "",
          contentHash: "",
          valid: false,
          error: {
            message: error.message || "Failed to inspect file.",
            code: "EDIT_INVALID"
          }
        };
      }
    }

    const diff = createUnifiedDiff(
      displayPath,
      fileExists ? originalContent : "",
      content
    );

    return {
      path: filePath,
      targetPath,
      displayPath,
      originalContent,
      proposedContent: content,
      diff,
      contentHash: createContentHash(content),
      valid: true
    };
  }
}
