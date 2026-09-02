import * as fs from "fs/promises";
import * as path from "path";
import type {
  CodeContextOptions,
  CodeContextResult,
  CodeContextSelector,
  CodeRegion
} from "./types.js";
import type { ExplorationResult } from "../exploration/types.js";
import { resolveSafePath } from "../tools/pathUtils.js";
import { isIgnoredFile } from "../tools/ignoreUtils.js";
import { estimateTokens } from "../optimization/estimator.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";

interface RawRange {
  startLine: number;
  endLine: number;
  reason: string;
  relevance: number;
}

export class DefaultCodeContextSelector implements CodeContextSelector {
  private cache: Map<string, CodeContextResult> = new Map();
  private explorer = new DefaultRepositoryExplorer();

  public async selectContext(
    exploration: ExplorationResult,
    query: string,
    options: CodeContextOptions = {}
  ): Promise<CodeContextResult> {
    const cwd = path.resolve(options.cwd || process.cwd());
    const maxFiles = options.maxFiles ?? 5;
    const maxRegionsPerFile = options.maxRegionsPerFile ?? 3;
    const maxLinesPerRegion = options.maxLinesPerRegion ?? 60;
    const maxTotalLines = options.maxTotalLines ?? 300;
    const maxEstimatedTokens = options.maxEstimatedTokens ?? 3000;
    const contextExpansionLines = options.contextExpansionLines ?? 20;
    const maxSmallFileLines = options.maxSmallFileLines ?? 120;

    const cacheKey = `${cwd}::${query.trim().toLowerCase()}::${maxFiles}::${maxTotalLines}::${maxEstimatedTokens}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (options.signal?.aborted) {
      throw new Error("Context selection aborted");
    }

    const searchTerms = this.explorer.extractSearchTerms(query);
    const candidateFiles = (exploration.relevantFiles || []).slice(0, maxFiles);
    const allRegions: CodeRegion[] = [];

    for (const relFile of candidateFiles) {
      if (options.signal?.aborted) {
        throw new Error("Context selection aborted");
      }

      const safe = resolveSafePath(cwd, relFile.path);
      if ("error" in safe) continue;

      const basename = path.basename(relFile.path);
      if (
        isIgnoredFile(basename) ||
        basename.startsWith(".env") ||
        basename.endsWith(".pem") ||
        basename === "id_rsa"
      ) {
        continue;
      }

      let content = "";
      try {
        content = await fs.readFile(safe.targetPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      // Case 1: Small files are included in their entirety
      if (totalLines <= maxSmallFileLines) {
        allRegions.push({
          path: relFile.path.replace(/\\/g, "/"),
          startLine: 1,
          endLine: totalLines,
          content,
          reason: relFile.reason || "Full file (<= 120 lines)",
          relevance: relFile.relevance || 100
        });
        continue;
      }

      // Case 2: Large files (> 120 lines) -> extract matching regions
      const rawRanges: RawRange[] = [];

      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const lineText = lines[i];

        for (const term of searchTerms) {
          const lowerLine = lineText.toLowerCase();
          const lowerTerm = term.toLowerCase();

          if (lowerLine.includes(lowerTerm)) {
            let relevance = (relFile.relevance || 50) + 20;
            const isDeclaration =
              lineText.includes("function ") ||
              lineText.includes("const ") ||
              lineText.includes("class ") ||
              lineText.includes("interface ") ||
              lineText.includes("type ") ||
              lineText.includes("export ");

            if (isDeclaration) {
              relevance += 30;
            }

            const start = Math.max(1, lineNum - contextExpansionLines);
            const end = Math.min(totalLines, lineNum + contextExpansionLines);

            rawRanges.push({
              startLine: start,
              endLine: end,
              reason: `Matches term "${term}" near line ${lineNum}`,
              relevance
            });
          }
        }
      }

      // Merge overlapping/adjacent ranges in this file
      const mergedRanges = this.mergeRanges(rawRanges, maxLinesPerRegion);
      const fileRegions = mergedRanges.slice(0, maxRegionsPerFile).map((r) => ({
        path: relFile.path.replace(/\\/g, "/"),
        startLine: r.startLine,
        endLine: r.endLine,
        content: lines.slice(r.startLine - 1, r.endLine).join("\n"),
        reason: r.reason,
        relevance: r.relevance
      }));

      allRegions.push(...fileRegions);
    }

    // Sort all regions by relevance descending, then path ascending, then startLine ascending
    allRegions.sort((a, b) => {
      if (b.relevance !== a.relevance) {
        return b.relevance - a.relevance;
      }
      if (a.path !== b.path) {
        return a.path.localeCompare(b.path);
      }
      return a.startLine - b.startLine;
    });

    // Enforce Token Budget & max limits
    const selectedRegions: CodeRegion[] = [];
    let accumulatedLines = 0;
    let accumulatedTokens = 0;
    let truncated = false;

    for (const region of allRegions) {
      const regionLines = region.endLine - region.startLine + 1;
      const regionTokens = estimateTokens(region.content);

      if (
        accumulatedLines + regionLines <= maxTotalLines &&
        accumulatedTokens + regionTokens <= maxEstimatedTokens
      ) {
        selectedRegions.push(region);
        accumulatedLines += regionLines;
        accumulatedTokens += regionTokens;
      } else {
        truncated = true;
      }
    }

    // Re-sort selected regions by path and startLine for clean readability
    selectedRegions.sort((a, b) => {
      if (a.path !== b.path) {
        return a.path.localeCompare(b.path);
      }
      return a.startLine - b.startLine;
    });

    const result: CodeContextResult = {
      regions: selectedRegions,
      totalLines: accumulatedLines,
      estimatedTokens: accumulatedTokens,
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

    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    for (const [key, result] of Array.from(this.cache.entries())) {
      if (
        result.regions.some((r) => {
          const rNorm = r.path.replace(/\\/g, "/").replace(/^\.\//, "");
          return (
            rNorm === normalized ||
            normalized.endsWith("/" + rNorm) ||
            rNorm.endsWith("/" + normalized) ||
            rNorm.includes(normalized) ||
            normalized.includes(rNorm)
          );
        })
      ) {
        this.cache.delete(key);
      }
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private mergeRanges(rawRanges: RawRange[], maxLinesPerRegion: number): RawRange[] {
    if (rawRanges.length === 0) return [];

    // Sort by startLine ascending
    const sorted = [...rawRanges].sort((a, b) => a.startLine - b.startLine);
    const merged: RawRange[] = [];

    for (const current of sorted) {
      if (merged.length === 0) {
        merged.push({ ...current });
        continue;
      }

      const last = merged[merged.length - 1];

      // If overlapping or within 3 lines of each other
      if (current.startLine <= last.endLine + 3) {
        last.endLine = Math.max(last.endLine, current.endLine);
        last.relevance = Math.max(last.relevance, current.relevance);
        if (!last.reason.includes(current.reason)) {
          last.reason = `${last.reason}; ${current.reason}`;
        }
      } else {
        merged.push({ ...current });
      }
    }

    // Clamp each range to maxLinesPerRegion
    for (const r of merged) {
      if (r.endLine - r.startLine + 1 > maxLinesPerRegion) {
        r.endLine = r.startLine + maxLinesPerRegion - 1;
      }
    }

    return merged;
  }
}
