import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";

export interface ReadFileInput {
  path: string;
}

export interface ReadFileOutput {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface ReadFileToolOptions {
  maxBytes?: number;
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pyc",
  ".class",
  ".o",
  ".obj"
]);

function isBinaryBuffer(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x00) {
      return true;
    }
  }
  return false;
}

export class ReadFileTool
  implements Tool<ReadFileInput, ReadFileOutput> {
  public readonly name = "read_file";
  public readonly permissionCategory = "read";
  public readonly description =
    "Read the text contents of a file within the project workspace.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative or absolute file path to read within the project workspace."
      }
    },
    required: ["path"]
  };

  private readonly maxBytes: number;

  constructor(options: ReadFileToolOptions = {}) {
    this.maxBytes = options.maxBytes ?? 100 * 1024; // 100 KB default
  }

  async execute(
    input: ReadFileInput,
    context: ToolContext
  ): Promise<ToolResult<ReadFileOutput>> {
    if (!input || !input.path) {
      return {
        success: false,
        error: {
          message: "The 'path' argument is required for read_file.",
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

    const ext = path.extname(targetPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: {
          message: `Cannot read binary file as source text (${input.path}).`,
          code: "BINARY_FILE"
        }
      };
    }

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: {
            message: `Path is a directory, not a file: ${input.path}`,
            code: "NOT_A_FILE"
          }
        };
      }

      const handle = await fs.open(targetPath, "r");
      try {
        const sampleSize = Math.min(stats.size, 1024);
        const sampleBuf = Buffer.alloc(sampleSize);
        if (sampleSize > 0) {
          await handle.read(sampleBuf, 0, sampleSize, 0);
          if (isBinaryBuffer(sampleBuf)) {
            return {
              success: false,
              error: {
                message: `Cannot read binary file as source text (${input.path}).`,
                code: "BINARY_FILE"
              }
            };
          }
        }

        const bytesToRead = Math.min(stats.size, this.maxBytes);
        const truncated = stats.size > this.maxBytes;
        const contentBuf = Buffer.alloc(bytesToRead);

        if (bytesToRead > 0) {
          await handle.read(contentBuf, 0, bytesToRead, 0);
        }

        const content = contentBuf.toString("utf-8");
        const lines = content ? content.split("\n") : [];
        const startLine = 1;
        const endLine = lines.length > 0 ? lines.length : 1;

        return {
          success: true,
          output: {
            path: displayPath,
            content,
            startLine,
            endLine,
            truncated
          }
        };
      } finally {
        await handle.close();
      }
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
            message: `Permission denied reading file: ${input.path}`,
            code: "PERMISSION_DENIED"
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to read file: ${error.message}`,
          code: error.code || "FILESYSTEM_ERROR"
        }
      };
    }
  }
}
