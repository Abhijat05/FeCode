import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRunHistoryStore } from "./runHistoryStore.js";
import type { DurableRunRecord } from "./types.js";

describe("Run Lineage & Cyclic Invariants — Phase 5O", () => {
  let tmpDir: string;
  let historyStore: DefaultRunHistoryStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-lineage-test-"));
    historyStore = new DefaultRunHistoryStore({ storageDir: tmpDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  function createMockRecord(
    runId: string,
    parentRunId?: string,
    resumeDepth?: number
  ): DurableRunRecord {
    return {
      schemaVersion: 1,
      runId,
      parentRunId,
      resumeDepth,
      projectId: "proj-test",
      cwd: tmpDir,
      userRequestSummary: `Task for ${runId}`,
      startedAt: Date.now(),
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    };
  }

  it("returns single-element lineage for a root run without parent", async () => {
    const runA = createMockRecord("run-A");
    await historyStore.saveRun(runA);

    const lineage = await historyStore.getRunLineage("run-A");
    expect(lineage.length).toBe(1);
    expect(lineage[0].runId).toBe("run-A");
  });

  it("reconstructs complete lineage chain (C -> B -> A) preserving depth and immutability", async () => {
    const runA = createMockRecord("run-A", undefined, 0);
    const runB = createMockRecord("run-B", "run-A", 1);
    const runC = createMockRecord("run-C", "run-B", 2);

    await historyStore.saveRun(runA);
    await historyStore.saveRun(runB);
    await historyStore.saveRun(runC);

    const lineage = await historyStore.getRunLineage("run-C");
    expect(lineage.length).toBe(3);
    expect(lineage[0].runId).toBe("run-C");
    expect(lineage[0].resumeDepth).toBe(2);
    expect(lineage[1].runId).toBe("run-B");
    expect(lineage[1].resumeDepth).toBe(1);
    expect(lineage[2].runId).toBe("run-A");
    expect(lineage[2].parentRunId).toBeUndefined();
  });

  it("gracefully prevents infinite loops on cyclic parent relationships (A -> A)", async () => {
    const runA = createMockRecord("run-self-cyclic", "run-self-cyclic", 1);
    await historyStore.saveRun(runA);

    const lineage = await historyStore.getRunLineage("run-self-cyclic");
    expect(lineage.length).toBe(1);
    expect(lineage[0].runId).toBe("run-self-cyclic");
  });

  it("gracefully prevents infinite loops on indirect cyclic relationships (A -> B -> A)", async () => {
    const runA = createMockRecord("run-cycle-A", "run-cycle-B", 1);
    const runB = createMockRecord("run-cycle-B", "run-cycle-A", 2);

    await historyStore.saveRun(runA);
    await historyStore.saveRun(runB);

    const lineage = await historyStore.getRunLineage("run-cycle-B");
    expect(lineage.length).toBe(2);
    expect(lineage[0].runId).toBe("run-cycle-B");
    expect(lineage[1].runId).toBe("run-cycle-A");
  });
});
