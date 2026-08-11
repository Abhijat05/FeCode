import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as readline from "readline";
import type { Tool, ToolContext, ToolResult } from "@fecode/models";
import { resolveSafePath } from "./pathUtils.js";
import { isIgnoredDirectory, isIgnoredFile } from "./ignoreUtils.js";

export interface SearchFilesInput {
  query: string;
  path?: string;
  maxResults?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchFilesOutput {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
  totalMatches?: number;
}

export interface SearchFilesToolOptions {
  maxResults?: number;
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

export class SearchFilesTool
  implements Tool<SearchFilesInput, SearchFilesOutput> {
  public readonly name = "search_files";
  public readonly description =
    "Search text or code matches recursively in the project workspace.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text query string to search for in files."
      },
      path: {
        type: "string",
        description:
          "Relative or absolute directory path to search within. Defaults to project root if omitted."
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matching lines to return. Defaults to 100."
      }
    },
    required: ["query"]
  };

  private readonly defaultMaxResults: number;

  constructor(options: SearchFilesToolOptions = {}) {
    this.defaultMaxResults = options.maxResults ?? 100;
  }

  async execute(
    input: SearchFilesInput,
    context: ToolContext
  ): Promise<ToolResult<SearchFilesOutput>> {
    if (!input || typeof input.query !== "string" || !input.query.trim()) {
      return {
        success: false,
        error: {
          message: "The 'query' argument is required and cannot be empty.",
          code: "INVALID_ARGUMENT"
        }
      };
    }

    const queryStr = input.query.trim();
    const queryLower = queryStr.toLowerCase();
    const maxResults = input.maxResults ?? this.defaultMaxResults;

    const pathRes = resolveSafePath(context.cwd, input.path);
    if ("error" in pathRes) {
      return {
        success: false,
        error: pathRes.error
      };
    }

    const { rootDir, targetPath, displayPath } = pathRes;

    try {
      const stats = await fs.stat(targetPath);
      const allMatches: SearchMatch[] = [];

      if (stats.isFile()) {
        await this.searchFile(
          targetPath,
          displayPath,
          queryLower,
          allMatches,
          context.signal
        );
      } else if (stats.isDirectory()) {
        await this.searchDirectory(
          targetPath,
          rootDir,
          queryLower,
          allMatches,
          context.signal
        );
      } else {
        return {
          success: false,
          error: {
            message: `Specified path is neither a file nor a directory: ${input.path || "."}`,
            code: "INVALID_PATH"
          }
        };
      }

      // Sort deterministically: path -> line -> column
      allMatches.sort((a, b) => {
        const pathCmp = a.path.localeCompare(b.path);
        if (pathCmp !== 0) return pathCmp;
        if (a.line !== b.line) return a.line - b.line;
        return a.column - b.column;
      });

      const truncated = allMatches.length > maxResults;
      const matches = truncated ? allMatches.slice(0, maxResults) : allMatches;

      return {
        success: true,
        output: {
          query: queryStr,
          matches,
          truncated,
          totalMatches: truncated ? allMatches.length : undefined
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === "ENOENT") {
        return {
          success: false,
          error: {
            message: `Path does not exist: ${input.path || "."}`,
            code: "NOT_FOUND"
          }
        };
      }

      if (error.code === "EACCES" || error.code === "EPERM") {
        return {
          success: false,
          error: {
            message: `Permission denied accessing path: ${input.path || "."}`,
            code: "PERMISSION_DENIED"
          }
        };
      }

      return {
        success: false,
        error: {
          message: `Failed to search files: ${error.message}`,
          code: error.code || "FILESYSTEM_ERROR"
        }
      };
    }
  }

  private async searchDirectory(
    dirPath: string,
    rootDir: string,
    queryLower: string,
    matches: SearchMatch[],
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) return;

    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal.aborted) return;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) {
          continue;
        }
        await this.searchDirectory(
          fullPath,
          rootDir,
          queryLower,
          matches,
          signal
        );
      } else if (entry.isFile()) {
        if (isIgnoredFile(entry.name)) {
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          continue;
        }

        await this.searchFile(
          fullPath,
          relPath,
          queryLower,
          matches,
          signal
        );
      }
    }
  }

  private async searchFile(
    filePath: string,
    displayPath: string,
    queryLower: string,
    matches: SearchMatch[],
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) return;

    try {
      const handle = await fs.open(filePath, "r");
      try {
        const sampleBuf = Buffer.alloc(1024);
        const { bytesRead } = await handle.read(sampleBuf, 0, 1024, 0);
        if (bytesRead > 0 && isBinaryBuffer(sampleBuf.subarray(0, bytesRead))) {
          return;
        }
      } finally {
        await handle.close();
      }

      const fileStream = fsSync.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNum = 0;
      for await (const line of rl) {
        if (signal.aborted) {
          rl.close();
          fileStream.destroy();
          return;
        }

        lineNum++;
        const lineLower = line.toLowerCase();
        let startIndex = 0;

        while (startIndex < lineLower.length) {
          const matchIndex = lineLower.indexOf(queryLower, startIndex);
          if (matchIndex === -1) break;

          matches.push({
            path: displayPath,
            line: lineNum,
            column: matchIndex + 1,
            text: line.trim()
          });

          // Move index past this match
          startIndex = matchIndex + queryLower.length;
        }
      }
    } catch {
      // Ignore unreadable individual files
    }
  }
}
