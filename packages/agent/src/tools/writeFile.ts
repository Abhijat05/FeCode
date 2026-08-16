import * as fs from "fs/promises";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";
import { writeAtomic } from "../editing/atomicWriter.js";
import { isSecretFile } from "../editing/validator.js";

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface WriteFileOutput {
  path: string;
  created: boolean;
  overwritten: boolean;
  bytesWritten: number;
}

export interface WriteFileToolOptions {
  maxBytes?: number;
}

export class WriteFileTool
  implements Tool<WriteFileInput, WriteFileOutput> {
  public readonly name = "write_file";
  public readonly permissionCategory = "write";
  public readonly description =
    "Create a new file or overwrite an existing file with specified text content within the project workspace.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative or absolute file path to create or overwrite within the project workspace."
      },
      content: {
        type: "string",
        description: "The exact text content to write into the file."
      }
    },
    required: ["path", "content"]
  };

  private readonly maxBytes: number;

  constructor(options: WriteFileToolOptions = {}) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024; // 10 MB default
  }

  async execute(
    input: WriteFileInput,
    context: ToolContext
  ): Promise<ToolResult<WriteFileOutput>> {
    if (!input || !input.path || typeof input.content !== "string") {
      return {
        success: false,
        error: {
          message: "Both 'path' and 'content' arguments are required for write_file.",
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
          message: `Writing to secret files is prohibited (${displayPath}).`,
          code: "SECRET_FILE"
        }
      };
    }

    const bytesWritten = Buffer.byteLength(input.content, "utf-8");
    if (bytesWritten > this.maxBytes) {
      return {
        success: false,
        error: {
          message: `File content exceeds maximum allowed write size (${bytesWritten} > ${this.maxBytes} bytes).`,
          code: "FILE_TOO_LARGE"
        }
      };
    }

    try {
      let fileExists = false;
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
          return {
            success: false,
            error: {
              message: `Cannot write to path because it is a directory: ${input.path}`,
              code: "NOT_A_FILE"
            }
          };
        }
        fileExists = true;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      await writeAtomic(targetPath, input.content, context.signal);

      return {
        success: true,
        output: {
          path: displayPath,
          created: !fileExists,
          overwritten: fileExists,
          bytesWritten
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "EACCES" || error.code === "EPERM") {
        return {
          success: false,
          error: {
            message: `Permission denied writing file: ${input.path}`,
            code: "PERMISSION_DENIED"
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to write file: ${error.message}`,
          code: error.code || "IO_ERROR"
        }
      };
    }
  }
}
