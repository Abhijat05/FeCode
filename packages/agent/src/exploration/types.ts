import type { ProjectProfile } from "../project/types.js";

export interface ExplorationFile {
  path: string;
  reason: string;
  relevance: number;
}

export interface ExplorationResult {
  query: string;
  relevantFiles: ExplorationFile[];
  directories: string[];
  matches: number;
  exploredFiles: number;
  truncated: boolean;
}

export interface ExplorationOptions {
  maxFiles?: number;
  cwd?: string;
  signal?: AbortSignal;
  projectProfile?: ProjectProfile;
}

export interface RepositoryExplorer {
  explore(query: string, options?: ExplorationOptions): Promise<ExplorationResult>;
  invalidate(filePath?: string): void;
  clearCache(): void;
}
