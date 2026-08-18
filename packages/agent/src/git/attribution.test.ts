import { describe, it, expect } from "vitest";
import { computeChangeAttribution } from "./attribution.js";
import type { RepositorySnapshot } from "./types.js";

describe("Git Change Attribution — Phase 5F", () => {
  it("distinguishes pre-existing modifications, FeCode changes, and preserved user files", () => {
    const baseline: RepositorySnapshot = {
      capturedAt: "2026-08-18T10:00:00Z",
      root: "/repo",
      branch: "main",
      files: [
        { path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/theme.ts", indexStatus: " ", worktreeStatus: "M" }
      ]
    };

    const postTask: RepositorySnapshot = {
      capturedAt: "2026-08-18T10:05:00Z",
      root: "/repo",
      branch: "main",
      files: [
        { path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/theme.ts", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/Login.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/auth/session.ts", indexStatus: "?", worktreeStatus: "?" }
      ]
    };

    const fecodeChanges = ["src/Login.tsx", "src/auth/session.ts"];

    const attribution = computeChangeAttribution(baseline, postTask, fecodeChanges);

    expect(attribution.preExistingFiles).toEqual(["src/App.tsx", "src/theme.ts"]);
    expect(attribution.fecodeFiles).toEqual(["src/Login.tsx", "src/auth/session.ts"]);
    expect(attribution.preservedUserFiles).toEqual(["src/App.tsx", "src/theme.ts"]);
    expect(attribution.unattributedFiles).toEqual([]);
  });

  it("identifies external/unattributed changes that appeared during the task", () => {
    const baseline: RepositorySnapshot = {
      capturedAt: "2026-08-18T10:00:00Z",
      root: "/repo",
      branch: "main",
      files: [{ path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M" }]
    };

    const postTask: RepositorySnapshot = {
      capturedAt: "2026-08-18T10:05:00Z",
      root: "/repo",
      branch: "main",
      files: [
        { path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/Login.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "debug.log", indexStatus: "?", worktreeStatus: "?" }
      ]
    };

    const fecodeChanges = ["src/Login.tsx"];

    const attribution = computeChangeAttribution(baseline, postTask, fecodeChanges);

    expect(attribution.preExistingFiles).toEqual(["src/App.tsx"]);
    expect(attribution.fecodeFiles).toEqual(["src/Login.tsx"]);
    expect(attribution.unattributedFiles).toEqual(["debug.log"]);
  });

  it("handles null snapshots gracefully", () => {
    const attribution = computeChangeAttribution(null, null, ["src/App.tsx"]);
    expect(attribution.preExistingFiles).toEqual([]);
    expect(attribution.fecodeFiles).toEqual(["src/App.tsx"]);
    expect(attribution.unattributedFiles).toEqual([]);
    expect(attribution.preservedUserFiles).toEqual([]);
  });
});
