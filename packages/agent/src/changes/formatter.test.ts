import { describe, it, expect } from "vitest";
import { ChangeIntelligenceFormatter } from "./formatter.js";
import type { ChangeSet } from "./types.js";

describe("ChangeIntelligenceFormatter — Phase 5E", () => {
  it("formats complete change summary with files, areas, and verification", () => {
    const changeSet: ChangeSet = {
      taskId: "task-1",
      files: [
        {
          path: "src/auth/session.ts",
          operation: "added",
          additions: 38,
          deletions: 0
        },
        {
          path: "src/components/LoginForm.tsx",
          operation: "modified",
          additions: 12,
          deletions: 3
        },
        {
          path: "src/components/LoginForm.test.tsx",
          operation: "modified",
          additions: 24,
          deletions: 0
        },
        {
          path: "src/hooks/useAuth.ts",
          operation: "added",
          additions: 17,
          deletions: 0
        }
      ],
      stats: {
        totalFiles: 4,
        addedFiles: 2,
        modifiedFiles: 2,
        deletedFiles: 0,
        totalAdditions: 91,
        totalDeletions: 3
      },
      areas: ["authentication", "components", "hooks", "tests"],
      categories: ["frontend", "tests"],
      commands: [
        {
          command: "npm run typecheck",
          exitCode: 0,
          timedOut: false,
          succeeded: true
        },
        {
          command: "npm test",
          exitCode: 0,
          timedOut: false,
          succeeded: true
        }
      ],
      verification: {
        attempted: true,
        passed: true,
        commands: ["npm run typecheck", "npm test"],
        failedCommands: []
      }
    };

    const output = ChangeIntelligenceFormatter.formatChangeSummary(changeSet);
    expect(output).toContain("Change Summary");
    expect(output).toContain("Files:\n  4 changed");
    expect(output).toContain("A src/auth/session.ts");
    expect(output).toContain("M src/components/LoginForm.tsx");
    expect(output).toContain("Lines:\n  +91 -3");
    expect(output).toContain("Areas:\n  authentication\n  components\n  hooks\n  tests");
    expect(output).toContain("Verification:\n  ✓ npm run typecheck\n  ✓ npm test");
    expect(output).toContain("Status:\n  Verified");
  });

  it("formats concise history impact", () => {
    const changeSet: ChangeSet = {
      files: [
        { path: "src/a.ts", operation: "modified", additions: 34, deletions: 4 },
        { path: "src/b.ts", operation: "modified", additions: 0, deletions: 0 }
      ],
      stats: {
        totalFiles: 2,
        addedFiles: 0,
        modifiedFiles: 2,
        deletedFiles: 0,
        totalAdditions: 34,
        totalDeletions: 4
      },
      areas: ["authentication", "components"],
      categories: ["frontend"],
      commands: [],
      verification: {
        attempted: false,
        passed: false,
        commands: [],
        failedCommands: []
      }
    };

    const historyLine = ChangeIntelligenceFormatter.formatConciseHistoryImpact(changeSet);
    expect(historyLine).toContain("2 files · +34 -4");
    expect(historyLine).toContain("authentication, components");
  });

  it("redacts sensitive keys in command displays", () => {
    const changeSet: ChangeSet = {
      files: [{ path: "src/a.ts", operation: "modified", additions: 1, deletions: 0 }],
      stats: {
        totalFiles: 1,
        addedFiles: 0,
        modifiedFiles: 1,
        deletedFiles: 0,
        totalAdditions: 1,
        totalDeletions: 0
      },
      areas: ["other"],
      categories: ["other"],
      commands: [],
      verification: {
        attempted: true,
        passed: true,
        commands: ["npm test --key=sk-abcdef1234567890abcdef1234567890"],
        failedCommands: []
      }
    };

    const output = ChangeIntelligenceFormatter.formatChangeSummary(changeSet);
    expect(output).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(output).toContain("[REDACTED_SECRET]");
  });
});
