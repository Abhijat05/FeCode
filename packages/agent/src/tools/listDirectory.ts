import * as fs from "fs/promises";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";

export interface ListDirectoryInput {
  path?: string;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export interface ListDirectoryOutput {
  path: string;
  entries: DirectoryEntry[];
  truncated?: boolean;
  totalCount?: number;
}

export interface ListDirectoryToolOptions {
  maxEntries?: number;
}

export class ListDirectoryTool
  implements Tool<ListDirectoryInput, ListDirectoryOutput> {
  public readonly name = "list_directory";
  public readonly description =
    "List files and directories within the project workspace.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative or absolute path to list within the project root. Defaults to project root if omitted."
      }
    }
  };

  private readonly maxEntries: number;

  constructor(options: ListDirectoryToolOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500;
  }

  async execute(
    input: ListDirectoryInput,
    context: ToolContext
  ): Promise<ToolResult<ListDirectoryOutput>> {
    const pathRes = resolveSafePath(context.cwd, input.path);
    if ("error" in pathRes) {
      return {
        success: false,
        error: pathRes.error
      };
    }

    const { targetPath, displayPath } = pathRes;

    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: {
            message: `Path is a file, not a directory: ${input.path || "."}`,
            code: "NOT_A_DIRECTORY"
          }
        };
      }

      const dirents = await fs.readdir(targetPath, { withFileTypes: true });

      const allEntries: DirectoryEntry[] = dirents
        .map((d) => ({
          name: d.name,
          type: (d.isDirectory() ? "directory" : "file") as "file" | "directory"
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const truncated = allEntries.length > this.maxEntries;
      const entries = truncated
        ? allEntries.slice(0, this.maxEntries)
        : allEntries;

      return {
        success: true,
        output: {
          path: displayPath,
          entries,
          truncated: truncated || undefined,
          totalCount: truncated ? allEntries.length : undefined
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "ENOENT") {
        return {
          success: false,
          error: {
            message: `Directory does not exist: ${input.path || "."}`,
            code: "NOT_FOUND"
          }
        };
      }

      if (error.code === "EACCES" || error.code === "EPERM") {
        return {
          success: false,
          error: {
            message: `Permission denied accessing directory: ${input.path || "."}`,
            code: "PERMISSION_DENIED"
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to list directory: ${error.message}`,
          code: error.code || "FILESYSTEM_ERROR"
        }
      };
    }
  }
}
