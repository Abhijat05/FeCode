export interface GitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  origPath?: string;
}

export interface GitStatus {
  isRepository: boolean;
  gitAvailable: boolean;
  root: string | null;
  branch: string | null;
  files: GitFileStatus[];
  ahead: number | null;
  behind: number | null;
  hasConflicts: boolean;
}

export interface RepositorySnapshot {
  capturedAt: string;
  root: string | null;
  branch: string | null;
  files: GitFileStatus[];
}

export interface ChangeAttribution {
  preExistingFiles: string[];
  fecodeFiles: string[];
  unattributedFiles: string[];
  preservedUserFiles: string[];
}

export interface GitRepository {
  isRepository(cwd: string): Promise<boolean>;
  getRoot(cwd: string): Promise<string | null>;
  getBranch(cwd: string): Promise<string | null>;
  getStatus(cwd: string): Promise<GitStatus>;
  getSnapshot(cwd: string): Promise<RepositorySnapshot>;
}
