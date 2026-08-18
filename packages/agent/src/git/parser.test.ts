import { describe, it, expect } from "vitest";
import { parseGitStatusPorcelain } from "./parser.js";

describe("Git Status Porcelain Parser — Phase 5F", () => {
  it("parses branch header with ahead and behind counts", () => {
    const output = "## main...origin/main [ahead 3, behind 1]\n M src/App.tsx";
    const res = parseGitStatusPorcelain(output);

    expect(res.branch).toBe("main");
    expect(res.ahead).toBe(3);
    expect(res.behind).toBe(1);
    expect(res.files.length).toBe(1);
    expect(res.files[0]).toEqual({
      path: "src/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
      origPath: undefined
    });
    expect(res.hasConflicts).toBe(false);
  });

  it("parses detached HEAD correctly", () => {
    const output = "## HEAD (no branch)\n?? notes.txt";
    const res = parseGitStatusPorcelain(output);

    expect(res.branch).toBe("HEAD detached");
    expect(res.files.length).toBe(1);
    expect(res.files[0].path).toBe("notes.txt");
    expect(res.files[0].indexStatus).toBe("?");
    expect(res.files[0].worktreeStatus).toBe("?");
  });

  it("parses initial commit branch headers", () => {
    const out1 = "## Initial commit on feature-branch\n";
    expect(parseGitStatusPorcelain(out1).branch).toBe("feature-branch");

    const out2 = "## No commits yet on master\n";
    expect(parseGitStatusPorcelain(out2).branch).toBe("master");
  });

  it("parses staged, unstaged, and mixed modifications", () => {
    const output = [
      "## feature/auth",
      "M  src/staged.ts",
      " M src/unstaged.ts",
      "MM src/mixed.ts",
      "A  src/added.ts",
      "D  src/deleted.ts",
      "?? src/untracked.ts"
    ].join("\n");

    const res = parseGitStatusPorcelain(output);
    expect(res.branch).toBe("feature/auth");
    expect(res.files.length).toBe(6);

    const paths = res.files.map((f) => f.path);
    expect(paths).toEqual([
      "src/added.ts",
      "src/deleted.ts",
      "src/mixed.ts",
      "src/staged.ts",
      "src/unstaged.ts",
      "src/untracked.ts"
    ]);
  });

  it("parses renamed files with original path", () => {
    const output = "## main\nR  old-name.ts -> new-name.ts";
    const res = parseGitStatusPorcelain(output);

    expect(res.files.length).toBe(1);
    expect(res.files[0]).toEqual({
      path: "new-name.ts",
      origPath: "old-name.ts",
      indexStatus: "R",
      worktreeStatus: " "
    });
  });

  it("detects merge conflicts", () => {
    const output = [
      "## main",
      "UU src/Conflict.tsx",
      "AA src/BothAdded.tsx"
    ].join("\n");

    const res = parseGitStatusPorcelain(output);
    expect(res.hasConflicts).toBe(true);
    expect(res.files.length).toBe(2);
  });

  it("handles empty clean repository output", () => {
    const output = "## main\n";
    const res = parseGitStatusPorcelain(output);

    expect(res.branch).toBe("main");
    expect(res.files.length).toBe(0);
    expect(res.hasConflicts).toBe(false);
  });
});
