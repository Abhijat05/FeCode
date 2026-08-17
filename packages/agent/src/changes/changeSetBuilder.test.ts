import { describe, it, expect } from "vitest";
import { ChangeSetBuilder } from "./changeSetBuilder.js";

describe("ChangeSetBuilder — Phase 5E", () => {
  it("aggregates multiple edits to the same file correctly", () => {
    const builder = new ChangeSetBuilder();

    builder.recordFileChange({
      path: "src/App.tsx",
      operation: "modified",
      additions: 5,
      deletions: 1
    });

    builder.recordFileChange({
      path: "src/App.tsx",
      operation: "modified",
      additions: 8,
      deletions: 2
    });

    const changeSet = builder.build("task-1");
    expect(changeSet.files.length).toBe(1);
    expect(changeSet.files[0]).toEqual({
      path: "src/App.tsx",
      operation: "modified",
      additions: 13,
      deletions: 3
    });
    expect(changeSet.stats.totalAdditions).toBe(13);
    expect(changeSet.stats.totalDeletions).toBe(3);
    expect(changeSet.stats.totalFiles).toBe(1);
    expect(changeSet.stats.modifiedFiles).toBe(1);
  });

  it("handles operation state transitions properly", () => {
    // 1. added then modified -> added
    const builder1 = new ChangeSetBuilder();
    builder1.recordFileChange({
      path: "src/New.tsx",
      operation: "added",
      additions: 20,
      deletions: 0
    });
    builder1.recordFileChange({
      path: "src/New.tsx",
      operation: "modified",
      additions: 5,
      deletions: 2
    });
    const cs1 = builder1.build();
    expect(cs1.files[0].operation).toBe("added");
    expect(cs1.stats.addedFiles).toBe(1);
    expect(cs1.stats.modifiedFiles).toBe(0);

    // 2. modified then deleted -> deleted
    const builder2 = new ChangeSetBuilder();
    builder2.recordFileChange({
      path: "src/Old.tsx",
      operation: "modified",
      additions: 2,
      deletions: 3
    });
    builder2.recordFileChange({
      path: "src/Old.tsx",
      operation: "deleted",
      additions: 0,
      deletions: 30
    });
    const cs2 = builder2.build();
    expect(cs2.files[0].operation).toBe("deleted");
    expect(cs2.stats.deletedFiles).toBe(1);
  });

  it("sorts files and areas deterministically", () => {
    const builder = new ChangeSetBuilder();

    builder.recordFileChange({
      path: "src/pages/Home.tsx",
      operation: "modified",
      additions: 10,
      deletions: 0
    });
    builder.recordFileChange({
      path: "src/components/Button.tsx",
      operation: "added",
      additions: 15,
      deletions: 0
    });
    builder.recordFileChange({
      path: "src/auth/session.ts",
      operation: "modified",
      additions: 2,
      deletions: 1
    });

    const cs = builder.build("task-2");
    expect(cs.files.map((f) => f.path)).toEqual([
      "src/auth/session.ts",
      "src/components/Button.tsx",
      "src/pages/Home.tsx"
    ]);

    expect(cs.areas).toEqual(["authentication", "components", "pages"]);
  });

  it("computes verification summary from recorded commands", () => {
    const builder = new ChangeSetBuilder();

    builder.recordCommand({
      command: "npm run typecheck",
      exitCode: 0,
      timedOut: false,
      succeeded: true
    });
    builder.recordCommand({
      command: "npm test",
      exitCode: 0,
      timedOut: false,
      succeeded: true
    });

    const cs = builder.build("task-3");
    expect(cs.verification.attempted).toBe(true);
    expect(cs.verification.passed).toBe(true);
    expect(cs.verification.commands).toEqual(["npm run typecheck", "npm test"]);
    expect(cs.verification.failedCommands).toEqual([]);
  });

  it("identifies failed verification accurately", () => {
    const builder = new ChangeSetBuilder();

    builder.recordCommand({
      command: "npm run typecheck",
      exitCode: 0,
      timedOut: false,
      succeeded: true
    });
    builder.recordCommand({
      command: "npm test",
      exitCode: 1,
      timedOut: false,
      succeeded: false
    });

    const cs = builder.build("task-4");
    expect(cs.verification.attempted).toBe(true);
    expect(cs.verification.passed).toBe(false);
    expect(cs.verification.commands).toEqual(["npm run typecheck"]);
    expect(cs.verification.failedCommands).toEqual(["npm test"]);
  });
});
