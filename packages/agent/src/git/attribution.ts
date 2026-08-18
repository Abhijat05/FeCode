import type { ChangeAttribution, RepositorySnapshot } from "./types.js";

/**
 * Computes change attribution by comparing baseline repository state,
 * post-task repository state, and FeCode's actual recorded changes.
 */
export function computeChangeAttribution(
  baseline: RepositorySnapshot | null,
  postTask: RepositorySnapshot | null,
  fecodeModifiedPaths: string[] = []
): ChangeAttribution {
  const norm = (p: string) => p.replace(/\\/g, "/").trim();

  const baselinePaths = new Set(
    (baseline?.files || []).map((f) => norm(f.path))
  );

  const fecodeSet = new Set(fecodeModifiedPaths.map(norm));

  const postTaskPaths = new Set(
    (postTask?.files || []).map((f) => norm(f.path))
  );

  const preExistingFiles: string[] = Array.from(baselinePaths).sort();
  const fecodeFiles: string[] = Array.from(fecodeSet).sort();

  const unattributedSet = new Set<string>();
  for (const p of postTaskPaths) {
    if (!baselinePaths.has(p) && !fecodeSet.has(p)) {
      unattributedSet.add(p);
    }
  }
  const unattributedFiles: string[] = Array.from(unattributedSet).sort();

  const preservedUserSet = new Set<string>();
  for (const p of baselinePaths) {
    if (!fecodeSet.has(p)) {
      preservedUserSet.add(p);
    }
  }
  const preservedUserFiles: string[] = Array.from(preservedUserSet).sort();

  return {
    preExistingFiles,
    fecodeFiles,
    unattributedFiles,
    preservedUserFiles
  };
}
