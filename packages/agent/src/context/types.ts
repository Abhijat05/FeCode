import type { ExplorationResult } from "../exploration/types.js";

export interface CodeRegion {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  reason: string;
  relevance: number;
}

export interface CodeContextResult {
  regions: CodeRegion[];
  totalLines: number;
  estimatedTokens: number;
  truncated: boolean;
}

export interface CodeContextOptions {
  maxFiles?: number;
  maxRegionsPerFile?: number;
  maxLinesPerRegion?: number;
  maxTotalLines?: number;
  maxEstimatedTokens?: number;
  contextExpansionLines?: number;
  maxSmallFileLines?: number;
  cwd?: string;
  signal?: AbortSignal;
}

export interface CodeContextSelector {
  selectContext(
    exploration: ExplorationResult,
    query: string,
    options?: CodeContextOptions
  ): Promise<CodeContextResult>;
  invalidate(filePath?: string): void;
  clearCache(): void;
}
