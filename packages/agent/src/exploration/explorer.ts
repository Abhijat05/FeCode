import * as fs from "fs/promises";
import * as path from "path";
import type {
  ExplorationFile,
  ExplorationOptions,
  ExplorationResult,
  RepositoryExplorer
} from "./types.js";
import { resolveSafePath } from "../tools/pathUtils.js";
import { isIgnoredDirectory, isIgnoredFile } from "../tools/ignoreUtils.js";

const STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "of", "to", "for", "is", "are", "was",
  "were", "why", "how", "what", "does", "do", "did", "after", "before",
  "this", "that", "and", "or", "not", "with", "from", "by", "at", "it",
  "fix", "add", "update", "change", "refactor", "create", "make", "help",
  "me", "please", "can", "you", "my", "our", "file", "files", "code"
]);

export class DefaultRepositoryExplorer implements RepositoryExplorer {
  private cache: Map<string, ExplorationResult> = new Map();

  public async explore(
    query: string,
    options: ExplorationOptions = {}
  ): Promise<ExplorationResult> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const maxFiles = options.maxFiles ?? 8;
    const cacheKey = `${cwd}::${query.trim().toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (options.signal?.aborted) {
      throw new Error("Exploration aborted");
    }

    const searchTerms = this.extractSearchTerms(query);
    if (searchTerms.length === 0) {
      const emptyResult: ExplorationResult = {
        query,
        relevantFiles: [],
        directories: [],
        matches: 0,
        exploredFiles: 0,
        truncated: false
      };
      return emptyResult;
    }

    const priorityDirs = this.getPriorityDirectories(options);
    const discoveredFiles: string[] = [];
    await this.collectFiles(cwd, cwd, priorityDirs, discoveredFiles, options.signal);

    if (options.signal?.aborted) {
      throw new Error("Exploration aborted");
    }

    const scoredFiles: Map<string, { relevance: number; reason: string }> = new Map();
    let totalMatches = 0;

    for (const relativePath of discoveredFiles) {
      if (options.signal?.aborted) {
        throw new Error("Exploration aborted");
      }

      const basename = path.basename(relativePath);
      const nameWithoutExt = basename.replace(/\.[^.]+$/, "");
      let relevance = 0;
      const reasons: string[] = [];

      for (const term of searchTerms) {
        const lowerTerm = term.toLowerCase();
        const lowerBasename = basename.toLowerCase();
        const lowerNameNoExt = nameWithoutExt.toLowerCase();
        const lowerPath = relativePath.toLowerCase();

        // Exact filename match
        if (lowerNameNoExt === lowerTerm || lowerBasename === lowerTerm) {
          relevance += 100;
          reasons.push(`matches term "${term}" in filename`);
        } else if (lowerBasename.includes(lowerTerm)) {
          relevance += 50;
          reasons.push(`contains "${term}" in filename`);
        } else if (lowerPath.includes(lowerTerm)) {
          relevance += 20;
          reasons.push(`path matches "${term}"`);
        }
      }

      // Check file content for matching terms (up to 200 lines)
      if (relevance > 0 || searchTerms.length > 0) {
        try {
          const fullPath = path.join(cwd, relativePath);
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n").slice(0, 200);
          const sample = lines.join("\n");

          let contentMatches = 0;
          for (const term of searchTerms) {
            const regex = new RegExp(term, "i");
            if (regex.test(sample)) {
              contentMatches++;
            }
          }

          if (contentMatches > 0) {
            totalMatches += contentMatches;
            relevance += contentMatches * 15;
            if (reasons.length === 0) {
              reasons.push(`contains ${contentMatches} matching keyword(s)`);
            }
          }
        } catch {
          // ignore unreadable file
        }
      }

      if (relevance > 0) {
        scoredFiles.set(relativePath, {
          relevance,
          reason: reasons.join(", ")
        });
      }
    }

    // Inspect imports for top scored files to find related components
    const topScored = Array.from(scoredFiles.entries())
      .sort((a, b) => b[1].relevance - a[1].relevance)
      .slice(0, 5);

    for (const [sourcePath] of topScored) {
      if (options.signal?.aborted) break;
      try {
        const fullSourcePath = path.join(cwd, sourcePath);
        const content = await fs.readFile(fullSourcePath, "utf-8");
        const importedPaths = this.extractImportPaths(content);
        const sourceDir = path.dirname(fullSourcePath);

        for (const imp of importedPaths) {
          const resolved = await this.resolveImportFile(sourceDir, imp, cwd);
          if (resolved && !scoredFiles.has(resolved)) {
            const sourceBase = path.basename(sourcePath);
            scoredFiles.set(resolved, {
              relevance: 25,
              reason: `imported by ${sourceBase}`
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // Sort and limit results
    const allRelevant: ExplorationFile[] = Array.from(scoredFiles.entries())
      .map(([filePath, data]) => ({
        path: filePath.replace(/\\/g, "/"),
        reason: data.reason,
        relevance: data.relevance
      }))
      .sort((a, b) => {
        if (b.relevance !== a.relevance) {
          return b.relevance - a.relevance;
        }
        return a.path.localeCompare(b.path);
      });

    const truncated = allRelevant.length > maxFiles;
    const finalRelevant = allRelevant.slice(0, maxFiles);

    // Extract unique directories
    const directoriesSet = new Set<string>();
    for (const file of finalRelevant) {
      const dir = path.dirname(file.path);
      if (dir && dir !== ".") {
        directoriesSet.add(dir);
      }
    }

    const result: ExplorationResult = {
      query,
      relevantFiles: finalRelevant,
      directories: Array.from(directoriesSet).sort(),
      matches: totalMatches || finalRelevant.length,
      exploredFiles: discoveredFiles.length,
      truncated
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  public invalidate(filePath?: string): void {
    if (!filePath) {
      this.clearCache();
      return;
    }

    const normalizedTarget = filePath.replace(/\\/g, "/");
    for (const [key, result] of Array.from(this.cache.entries())) {
      if (result.relevantFiles.some((f) => f.path.includes(normalizedTarget))) {
        this.cache.delete(key);
      }
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public extractSearchTerms(query: string): string[] {
    const rawTokens = query
      .replace(/['"`?:!,.;()[\]{}]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const terms: Set<string> = new Set();

    for (const token of rawTokens) {
      if (STOP_WORDS.has(token.toLowerCase())) {
        continue;
      }

      // Add whole token
      terms.add(token);

      // Split CamelCase / PascalCase
      const subTokens = token.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
      if (subTokens.length > 1) {
        for (const sub of subTokens) {
          if (sub.length > 1 && !STOP_WORDS.has(sub.toLowerCase())) {
            terms.add(sub);
          }
        }
      }
    }

    return Array.from(terms);
  }

  private getPriorityDirectories(options: ExplorationOptions): string[] {
    const profile = options.projectProfile;
    if (profile?.importantDirectories && profile.importantDirectories.length > 0) {
      return profile.importantDirectories;
    }

    // Default heuristics based on frameworks
    const frameworks = profile?.frameworks || [];
    const list = ["src", "components", "pages", "app", "lib", "utils", "routes", "tests"];

    if (frameworks.some((f) => f.toLowerCase().includes("next"))) {
      return ["app", "pages", "components", "lib", "src"];
    }
    if (frameworks.some((f) => f.toLowerCase().includes("svelte"))) {
      return ["src", "routes", "lib"];
    }
    return list;
  }

  private async collectFiles(
    rootDir: string,
    currentDir: string,
    priorityDirs: string[],
    collected: string[],
    signal?: AbortSignal,
    depth: number = 0
  ): Promise<void> {
    if (signal?.aborted || depth > 8 || collected.length > 1000) {
      return;
    }

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      // Sort entries deterministically
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (signal?.aborted) return;

        const name = entry.name;
        if (entry.isDirectory()) {
          if (isIgnoredDirectory(name) || name.startsWith(".")) {
            continue;
          }
          const fullPath = path.join(currentDir, name);
          const safe = resolveSafePath(rootDir, fullPath);
          if ("error" in safe) continue;

          await this.collectFiles(rootDir, fullPath, priorityDirs, collected, signal, depth + 1);
        } else if (entry.isFile()) {
          if (
            isIgnoredFile(name) ||
            name.startsWith(".env") ||
            name.endsWith(".pem") ||
            name.endsWith(".lock") ||
            name === "id_rsa"
          ) {
            continue;
          }

          const fullPath = path.join(currentDir, name);
          const safe = resolveSafePath(rootDir, fullPath);
          if ("error" in safe) continue;

          const relative = path.relative(rootDir, fullPath);
          collected.push(relative);
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  private extractImportPaths(content: string): string[] {
    const importRegex = /(?:import|from|require)\s*\(?['"](\.[^'"]+)['"]/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        paths.push(match[1]);
      }
    }
    return paths;
  }

  private async resolveImportFile(
    sourceDir: string,
    importPath: string,
    rootDir: string
  ): Promise<string | null> {
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".svelte", ".vue", "/index.ts", "/index.tsx", "/index.js"];
    const basePath = path.resolve(sourceDir, importPath);

    for (const ext of extensions) {
      const candidate = basePath + ext;
      const safe = resolveSafePath(rootDir, candidate);
      if ("error" in safe) continue;

      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          return path.relative(rootDir, candidate);
        }
      } catch {
        // continue
      }
    }
    return null;
  }
}
