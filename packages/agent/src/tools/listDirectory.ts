import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";
import { isIgnoredDirectory } from "./ignoreUtils.js";

export interface ListDirectoryInput {
  path?: string;
  depth?: number;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  broken?: boolean;
  target?: string;
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
  public readonly permissionCategory = "read";
  public readonly description =
    "List files and directories within the project workspace. Supports optional depth (1-5) to inspect nested subdirectories.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative or absolute path to list within the project root. Defaults to project root if omitted."
      },
      depth: {
        type: "number",
        description:
          "Optional directory traversal depth (1-5). Defaults to 1 (shallow listing). Use 2 or 3 to inspect nested subdirectories and files in a tree structure."
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

      const requestedDepth =
        typeof input.depth === "number" && !isNaN(input.depth)
          ? Math.max(1, Math.min(Math.floor(input.depth), 5))
          : 1;

      const allEntries: DirectoryEntry[] = [];
      const visitedCanonical = new Set<string>();

      const collect = async (
        dirPath: string,
        prefix: string,
        currentDepth: number
      ): Promise<void> => {
        if (context.signal?.aborted) return;

        let canonical: string;
        try {
          canonical = await fs.realpath(dirPath);
        } catch {
          canonical = dirPath;
        }

        if (visitedCanonical.has(canonical)) return;
        visitedCanonical.add(canonical);

        let dirents;
        try {
          dirents = await fs.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        dirents.sort((a, b) => a.name.localeCompare(b.name));

        for (const d of dirents) {
          if (context.signal?.aborted) return;
          const entryName = prefix ? `${prefix}/${d.name}` : d.name;
          const fullEntryPath = path.join(dirPath, d.name);

          if (d.isSymbolicLink()) {
            let linkTarget: string | undefined;
            try {
              linkTarget = await fs.readlink(fullEntryPath);
            } catch {
              // Target unreadable
            }

            let isBroken = false;
            try {
              await fs.stat(fullEntryPath);
            } catch {
              isBroken = true;
            }

            allEntries.push({
              name: entryName,
              type: "symlink",
              ...(linkTarget ? { target: linkTarget } : {}),
              ...(isBroken ? { broken: true } : {})
            });
          } else if (d.isDirectory()) {
            allEntries.push({
              name: entryName,
              type: "directory"
            });

            // Recurse into subdirectories if depth allows
            if (currentDepth < requestedDepth) {
              if (!isIgnoredDirectory(d.name)) {
                await collect(fullEntryPath, entryName, currentDepth + 1);
              }
            }
          } else {
            allEntries.push({
              name: entryName,
              type: "file"
            });
          }
        }
      };

      await collect(targetPath, "", 1);

      // Sort all collected entries deterministically by name
      allEntries.sort((a, b) => a.name.localeCompare(b.name));

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
