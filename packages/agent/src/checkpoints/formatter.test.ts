import { describe, it, expect } from "vitest";
import { CheckpointFormatter } from "./formatter.js";
import type { Checkpoint, CheckpointComparison } from "./types.js";

describe("CheckpointFormatter — Phase 5G", () => {
  it("formats risk prompt cleanly", () => {
    const prompt = CheckpointFormatter.formatRiskPrompt({
      risky: true,
      reasons: ["5 files may be modified", "package.json will change"]
    });

    expect(prompt).toContain("⚠ Risky task detected");
    expect(prompt).toContain("• 5 files may be modified");
    expect(prompt).toContain("• package.json will change");
    expect(prompt).toContain("Create checkpoint? [y/N]");
  });

  it("formats checkpoint created output", () => {
    const cp: Checkpoint = {
      id: "checkpoint-a1b2c3",
      createdAt: new Date().toISOString(),
      repositoryRoot: "/repo",
      branch: "feature/auth",
      files: [],
      totalFiles: 7,
      status: "ready",
      isGit: true
    };

    const text = CheckpointFormatter.formatCheckpointCreated(cp);
    expect(text).toContain("✓ Checkpoint created");
    expect(text).toContain("ID:\n  checkpoint-a1b2c3");
    expect(text).toContain("Branch:\n  feature/auth");
    expect(text).toContain("Files captured:\n  7");
  });

  it("formats checkpoint inspection detail", () => {
    const cp: Checkpoint = {
      id: "checkpoint-a1b2c3",
      createdAt: "2026-08-18T22:15:00Z",
      repositoryRoot: "/repo",
      branch: "feature/auth",
      files: [],
      totalFiles: 7,
      status: "ready",
      isGit: true
    };

    const text = CheckpointFormatter.formatCheckpointDetail(cp);
    expect(text).toContain("Checkpoint:\n  checkpoint-a1b2c3");
    expect(text).toContain("Branch:\n  feature/auth");
    expect(text).toContain("Files:\n  7");
    expect(text).toContain("Status:\n  Ready");
  });

  it("formats checkpoint comparison diff", () => {
    const comparison: CheckpointComparison = {
      checkpointId: "checkpoint-a1b2c3",
      createdAt: "2026-08-18T22:15:00Z",
      files: [
        {
          path: "src/components/Login.tsx",
          operation: "modified",
          additions: 12,
          deletions: 3
        },
        {
          path: "src/auth/session.ts",
          operation: "added",
          additions: 38,
          deletions: 0
        }
      ],
      totalAdditions: 50,
      totalDeletions: 3
    };

    const text = CheckpointFormatter.formatCheckpointComparison(comparison);
    expect(text).toContain("Checkpoint:\n  checkpoint-a1b2c3");
    expect(text).toContain("M src/components/Login.tsx");
    expect(text).toContain("A src/auth/session.ts");
    expect(text).toContain("Total:\n  +50 -3");
  });
});
