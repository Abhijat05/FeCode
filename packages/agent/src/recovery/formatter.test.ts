import { describe, it, expect } from "vitest";
import { RecoveryFormatter } from "./formatter.js";
import type {
  RecoveryPreview,
  RecoveryRecord,
  RecoveryResult
} from "./types.js";

describe("RecoveryFormatter — Phase 5H", () => {
  it("formats recovery preview when safe", () => {
    const preview: RecoveryPreview = {
      checkpointId: "checkpoint-a1b2c3",
      currentBranch: "feature/auth",
      checkpointBranch: "feature/auth",
      repositoryRoot: "/repo",
      files: [
        {
          path: "src/components/Login.tsx",
          operation: "restore",
          additions: 12,
          deletions: 3
        },
        {
          path: "src/auth/session.ts",
          operation: "delete",
          additions: 0,
          deletions: 38
        }
      ],
      totalFiles: 2,
      preExistingFiles: ["src/App.tsx", "src/theme.ts"],
      safe: true,
      reasons: [],
      conflicts: []
    };

    const text = RecoveryFormatter.formatRecoveryPreview(preview);
    expect(text).toContain("Recovery Preview");
    expect(text).toContain("Checkpoint:\n  checkpoint-a1b2c3");
    expect(text).toContain("Current branch:\n  feature/auth");
    expect(text).toContain("Potentially affected:\n  2 files");
    expect(text).toContain("Pre-existing changes:\n  2 files");
    expect(text).toContain("Recovery will:\n  restore checkpoint state for affected FeCode changes");
    expect(text).toContain("Recovery will NOT:\n  overwrite unrelated pre-existing changes");
  });

  it("formats recovery preview when blocked", () => {
    const preview: RecoveryPreview = {
      checkpointId: "checkpoint-a1b2c3",
      currentBranch: "feature/payment",
      checkpointBranch: "feature/auth",
      repositoryRoot: "/repo",
      files: [],
      totalFiles: 0,
      preExistingFiles: [],
      safe: false,
      reasons: ["Checkpoint branch differs from current branch"],
      conflicts: []
    };

    const text = RecoveryFormatter.formatRecoveryPreview(preview);
    expect(text).toContain("⚠ Recovery blocked");
    expect(text).toContain("Reason:\n  Checkpoint branch differs from current branch");
    expect(text).toContain("No files were modified.");
  });

  it("formats recovery prompt", () => {
    const preview: RecoveryPreview = {
      checkpointId: "checkpoint-a1b2c3",
      currentBranch: "feature/auth",
      checkpointBranch: "feature/auth",
      repositoryRoot: "/repo",
      files: [
        {
          path: "src/Login.tsx",
          operation: "restore",
          additions: 91,
          deletions: 3
        }
      ],
      totalFiles: 1,
      preExistingFiles: [],
      safe: true,
      reasons: [],
      conflicts: []
    };

    const prompt = RecoveryFormatter.formatRecoveryPrompt(preview);
    expect(prompt).toContain("⚠ FeCode wants to restore a checkpoint");
    expect(prompt).toContain("Checkpoint:\n  checkpoint-a1b2c3");
    expect(prompt).toContain("Affected files:\n  1");
    expect(prompt).toContain("Changes to revert:\n  +91 -3");
    expect(prompt).toContain("Potential conflicts:\n  0");
    expect(prompt).toContain("Proceed? [y/N]");
  });

  it("formats recovery results (completed, blocked, and failed)", () => {
    const completedRes: RecoveryResult = {
      success: true,
      checkpointId: "checkpoint-a1b2c3",
      status: "completed",
      recoveredFiles: ["src/Login.tsx", "src/auth.ts"],
      preservedFiles: ["src/App.tsx"],
      conflicts: []
    };
    const completedText = RecoveryFormatter.formatRecoveryResult(completedRes);
    expect(completedText).toContain("✓ Recovery completed");
    expect(completedText).toContain("Recovered:\n  2 files");
    expect(completedText).toContain("Preserved:\n  1 pre-existing file");

    const blockedRes: RecoveryResult = {
      success: false,
      checkpointId: "checkpoint-a1b2c3",
      status: "blocked",
      recoveredFiles: [],
      preservedFiles: [],
      conflicts: [{ path: ".env", reason: "Protected file" }],
      error: "Protected file detected"
    };
    const blockedText = RecoveryFormatter.formatRecoveryResult(blockedRes);
    expect(blockedText).toContain("✗ Recovery blocked");
    expect(blockedText).toContain("Conflicts:\n  1");
    expect(blockedText).toContain("No files were modified.");
  });

  it("formats recovery status", () => {
    const record: RecoveryRecord = {
      checkpointId: "checkpoint-a1b2c3",
      startedAt: "2026-08-19T10:00:00Z",
      completedAt: "2026-08-19T10:00:02Z",
      status: "completed",
      affectedFiles: ["src/Login.tsx", "src/auth.ts", "src/Nav.tsx"],
      preservedFiles: [],
      conflicts: []
    };

    const statusText = RecoveryFormatter.formatRecoveryStatus(
      record,
      "checkpoint-a1b2c3"
    );
    expect(statusText).toContain("Recovery");
    expect(statusText).toContain("Last checkpoint:\n  checkpoint-a1b2c3");
    expect(statusText).toContain("Last recovery:\n  Completed");
    expect(statusText).toContain("Recovered:\n  3 files");
  });
});
