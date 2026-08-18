import { describe, it, expect } from "vitest";
import { GitStatusFormatter } from "./formatter.js";
import type { GitStatus, ChangeAttribution } from "./types.js";

describe("GitStatusFormatter — Phase 5F", () => {
  it("formats git status with branch, changes, and attribution", () => {
    const status: GitStatus = {
      isRepository: true,
      gitAvailable: true,
      root: "D:/projects/shop",
      branch: "feature/auth",
      files: [
        { path: "src/App.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "src/Login.tsx", indexStatus: " ", worktreeStatus: "M" },
        { path: "notes.txt", indexStatus: "?", worktreeStatus: "?" }
      ],
      ahead: null,
      behind: null,
      hasConflicts: false
    };

    const attribution: ChangeAttribution = {
      preExistingFiles: ["src/App.tsx"],
      fecodeFiles: ["src/Login.tsx"],
      unattributedFiles: ["notes.txt"],
      preservedUserFiles: ["src/App.tsx"]
    };

    const text = GitStatusFormatter.formatGitStatus(status, attribution);
    expect(text).toContain("Git");
    expect(text).toContain("Repository:\n  D:/projects/shop");
    expect(text).toContain("Branch:\n  feature/auth");
    expect(text).toContain("Status:\n  3 changed files");
    expect(text).toContain("Pre-existing:\n  1 file");
    expect(text).toContain("Current task:\n  1 FeCode change");
    expect(text).toContain("Untracked:\n  1 file");
    expect(text).toContain("Conflicts:\n  0");
  });

  it("formats non-repository status cleanly", () => {
    const status: GitStatus = {
      isRepository: false,
      gitAvailable: true,
      root: null,
      branch: null,
      files: [],
      ahead: null,
      behind: null,
      hasConflicts: false
    };

    const text = GitStatusFormatter.formatGitStatus(status);
    expect(text).toContain("Not a Git repository");
  });

  it("formats git unavailable cleanly", () => {
    const status: GitStatus = {
      isRepository: false,
      gitAvailable: false,
      root: null,
      branch: null,
      files: [],
      ahead: null,
      behind: null,
      hasConflicts: false
    };

    const text = GitStatusFormatter.formatGitStatus(status);
    expect(text).toContain("Git executable not available");
  });

  it("formats task git attribution", () => {
    const attribution: ChangeAttribution = {
      preExistingFiles: ["src/App.tsx", "src/theme.ts"],
      fecodeFiles: ["src/Login.tsx", "src/auth/session.ts"],
      unattributedFiles: [],
      preservedUserFiles: ["src/App.tsx", "src/theme.ts"]
    };

    const text = GitStatusFormatter.formatTaskGitAttribution(
      "feature/auth",
      attribution,
      "+91 -3"
    );

    expect(text).toContain("Git:\n  feature/auth");
    expect(text).toContain("Pre-existing:\n  2 files");
    expect(text).toContain("FeCode changes:\n  2 files · +91 -3");
    expect(text).toContain("Unattributed:\n  0 files");
    expect(text).toContain("User changes preserved:\n  ✓ src/App.tsx\n  ✓ src/theme.ts");
  });
});
