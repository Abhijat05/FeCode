import * as fs from "fs/promises";
import * as fsSync from "fs";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";
import { createUnifiedDiff } from "./diffUtils.js";
import { writeAtomic } from "../editing/atomicWriter.js";
import { isSecretFile } from "../editing/validator.js";
import { createContentHash } from "../editing/hashUtils.js";

export interface EditFileInput {
  path: string;
  oldText: string;
  newText: string;
  expectedHash?: string;
}

export interface EditFileOutput {
  path: string;
  replacements: number;
  bytesWritten: number;
  changed: boolean;
  reason?: string;
  diff?: string;
  contentHash?: string;
}

export interface EditFileToolOptions {
  maxBytes?: number;
  onPreWrite?: () => Promise<void>;
  statFn?: (path: string) => Promise<fsSync.Stats>;
}

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

export class EditFileTool
  implements Tool<EditFileInput, EditFileOutput> {
  public readonly name = "edit_file";
  public readonly permissionCategory = "write";
  public readonly description =
    "Modify an existing file by replacing an exact, unique text block with new text within the project workspace.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative or absolute file path to edit within the project workspace."
      },
      oldText: {
        type: "string",
        description: "The exact, unique block of text to be replaced."
      },
      newText: {
        type: "string",
        description: "The new text to insert in place of oldText."
      }
    },
    required: ["path", "oldText", "newText"]
  };

  private readonly maxBytes: number;
  private readonly onPreWrite?: () => Promise<void>;
  private readonly statFn: (path: string) => Promise<fsSync.Stats>;

  constructor(options: EditFileToolOptions = {}) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024; // 10 MB default
    this.onPreWrite = options.onPreWrite;
    this.statFn = options.statFn ?? fs.stat;
  }

  async execute(
    input: EditFileInput,
    context: ToolContext
  ): Promise<ToolResult<EditFileOutput>> {
    if (
      !input ||
      !input.path ||
      typeof input.oldText !== "string" ||
      typeof input.newText !== "string"
    ) {
      return {
        success: false,
        error: {
          message: "The 'path', 'oldText', and 'newText' arguments are all required for edit_file.",
          code: "INVALID_ARGUMENT"
        }
      };
    }

    const pathRes = resolveSafePath(context.cwd, input.path);
    if ("error" in pathRes) {
      return {
        success: false,
        error: pathRes.error
      };
    }

    const { targetPath, displayPath } = pathRes;

    if (isSecretFile(displayPath)) {
      return {
        success: false,
        error: {
          message: `Editing secret files is prohibited (${displayPath}).`,
          code: "SECRET_FILE"
        }
      };
    }

    if (input.oldText === input.newText) {
      return {
        success: true,
        output: {
          path: displayPath,
          replacements: 0,
          bytesWritten: 0,
          changed: false,
          reason: "NO_CHANGE"
        }
      };
    }

    try {
      const stats = await this.statFn(targetPath);
      if (!stats.isFile()) {
        const typeStr = stats.isDirectory()
          ? "directory"
          : stats.isFIFO?.()
            ? "FIFO pipe"
            : stats.isSocket?.()
              ? "socket"
              : stats.isCharacterDevice?.() || stats.isBlockDevice?.()
                ? "device"
                : "special file";
        return {
          success: false,
          error: {
            message: `Cannot edit path because it is a ${typeStr}, not a regular file: ${input.path}`,
            code: "NOT_A_FILE"
          }
        };
      }

      const originalContent = await fs.readFile(targetPath, "utf-8");
      const currentHash = createContentHash(originalContent);

      if (input.expectedHash && currentHash !== input.expectedHash) {
        return {
          success: false,
          error: {
            message: `File content has changed since context was selected (${displayPath}).`,
            code: "EDIT_CONFLICT"
          }
        };
      }

      let effectiveOldText = input.oldText;
      let effectiveNewText = input.newText;
      let matchCount = countOccurrences(originalContent, effectiveOldText);

      if (matchCount === 0) {
        const isFileCrlf = originalContent.includes("\r\n");
        if (isFileCrlf && input.oldText.includes("\n")) {
          const crlfOld = input.oldText.replace(/\r?\n/g, "\r\n");
          if (countOccurrences(originalContent, crlfOld) > 0) {
            effectiveOldText = crlfOld;
            effectiveNewText = input.newText.replace(/\r?\n/g, "\r\n");
            matchCount = countOccurrences(originalContent, effectiveOldText);
          }
        } else if (!isFileCrlf && input.oldText.includes("\r\n")) {
          const lfOld = input.oldText.replace(/\r\n/g, "\n");
          if (countOccurrences(originalContent, lfOld) > 0) {
            effectiveOldText = lfOld;
            effectiveNewText = input.newText.replace(/\r\n/g, "\n");
            matchCount = countOccurrences(originalContent, effectiveOldText);
          }
        }
      }

      if (matchCount === 0) {
        return {
          success: false,
          error: {
            message: `Could not find exact text match for oldText in ${input.path}. Ensure oldText matches the target content exactly.`,
            code: "EDIT_NOT_FOUND"
          }
        };
      }

      if (matchCount > 1) {
        return {
          success: false,
          error: {
            message: `Found multiple (${matchCount}) occurrences of oldText in ${input.path}. Specify more surrounding context to uniquely identify the edit.`,
            code: "AMBIGUOUS_EDIT"
          }
        };
      }

      const proposedContent = originalContent.replace(effectiveOldText, () => effectiveNewText);
      const bytesWritten = Buffer.byteLength(proposedContent, "utf-8");

      if (bytesWritten > this.maxBytes) {
        return {
          success: false,
          error: {
            message: `Proposed file content exceeds maximum allowed size (${bytesWritten} > ${this.maxBytes} bytes).`,
            code: "FILE_TOO_LARGE"
          }
        };
      }

      const diff = createUnifiedDiff(displayPath, originalContent, proposedContent);

      if (this.onPreWrite) {
        await this.onPreWrite();
      }

      // Post-approval second-read conflict check to verify file was not mutated on disk
      const freshContent = await fs.readFile(targetPath, "utf-8");
      const freshMatchCount = countOccurrences(freshContent, effectiveOldText);
      if (freshMatchCount !== 1) {
        return {
          success: false,
          error: {
            message: `File content changed during approval review. The expected edit is no longer valid.`,
            code: "EDIT_CONFLICT"
          }
        };
      }

      await writeAtomic(targetPath, proposedContent, context.signal);

      return {
        success: true,
        output: {
          path: displayPath,
          replacements: 1,
          bytesWritten,
          changed: true,
          diff,
          contentHash: createContentHash(proposedContent)
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "ENOENT") {
        return {
          success: false,
          error: {
            message: `File does not exist: ${input.path}`,
            code: "NOT_FOUND"
          }
        };
      }

      if (error.code === "EACCES" || error.code === "EPERM") {
        return {
          success: false,
          error: {
            message: `Permission denied editing file: ${input.path}`,
            code: "PERMISSION_DENIED"
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to edit file: ${error.message}`,
          code: error.code || "IO_ERROR"
        }
      };
    }
  }
}
