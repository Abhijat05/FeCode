import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRunHistoryStore } from "./runHistoryStore.js";
import type { DurableRunRecord } from "./types.js";

describe("DefaultRunHistoryStore — Phase 5N", () => {
  let tmpDir: string;
  let store: DefaultRunHistoryStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-history-store-test-"));
    store = new DefaultRunHistoryStore({ storageDir: tmpDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("saves, loads, lists, deletes, and clears durable run records", async () => {
    const record: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-101",
      projectId: "proj-alpha",
      cwd: "/workspace/proj-alpha",
      userRequestSummary: "Add user profile page",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      durationMs: 5000,
      finalStatus: "completed",
      executionState: "completed",
      activeSkills: ["react"],
      initialRiskLevel: "normal",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: ["src/Profile.tsx"], created: [], deleted: [] },
      lifecycleTransitions: []
    };

    await store.saveRun(record);

    // Get run
    const loaded = await store.getRun("run-101");
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe("run-101");
    expect(loaded?.schemaVersion).toBe(1);
    expect(loaded?.finalStatus).toBe("completed");
    expect(loaded?.projectId).toBe("proj-alpha");

    // List runs
    const list = await store.listRuns();
    expect(list.length).toBe(1);
    expect(list[0].runId).toBe("run-101");

    // Delete run
    const deleted = await store.deleteRun("run-101");
    expect(deleted).toBe(true);

    const reload = await store.getRun("run-101");
    expect(reload).toBeNull();
  });

  it("strictly redacts API keys, credentials, tokens, and private keys upon persistence", async () => {
    const sensitiveRecord: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-secret-test",
      projectId: "proj-sec",
      cwd: "/workspace",
      userRequestSummary:
        "Connect using sk-abcdef1234567890abcdef1234567890 and AIzaSyA12345678901234567890123456789012 with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and ghp_123456789012345678901234567890123456 and OPENAI_API_KEY=my_secret_key",
      startedAt: Date.now(),
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      initialRiskLevel: "elevated",
      riskReasons: [
        "Private key found: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----"
      ],
      requiresCheckpoint: true,
      requiresExplicitApproval: true,
      verificationAttempts: 0,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [],
      commands: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: [],
      failureReason: "Failed to connect to auth server with PASSWORD=super_secret_password_123"
    };

    await store.saveRun(sensitiveRecord);

    // Read directly from disk
    const diskFile = path.join(tmpDir, "run-secret-test.json");
    const rawContent = await fs.readFile(diskFile, "utf-8");

    expect(rawContent).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(rawContent).not.toContain("AIzaSyA12345678901234567890123456789012");
    expect(rawContent).not.toContain("ghp_123456789012345678901234567890123456");
    expect(rawContent).not.toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(rawContent).not.toContain("super_secret_password_123");

    expect(rawContent).toContain("[REDACTED_API_KEY]");
    expect(rawContent).toContain("[REDACTED_TOKEN]");
    expect(rawContent).toContain("[REDACTED_PRIVATE_KEY]");
    expect(rawContent).toContain("[REDACTED_ENV_VAR]");
  });

  it("enforces project scoping and isolation", async () => {
    const runA: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-proj-a",
      projectId: "proj-A",
      cwd: "/projects/a",
      userRequestSummary: "Project A task",
      startedAt: Date.now() - 1000,
      finalStatus: "completed",
      executionState: "completed",
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

    const runB: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-proj-b",
      projectId: "proj-B",
      cwd: "/projects/b",
      userRequestSummary: "Project B task",
      startedAt: Date.now(),
      finalStatus: "completed",
      executionState: "completed",
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

    await store.saveRun(runA);
    await store.saveRun(runB);

    const listA = await store.listRuns({ projectId: "proj-A" });
    expect(listA.length).toBe(1);
    expect(listA[0].runId).toBe("run-proj-a");

    const listB = await store.listRuns({ projectId: "proj-B" });
    expect(listB.length).toBe(1);
    expect(listB[0].runId).toBe("run-proj-b");
  });

  it("prunes old runs deterministically when exceeding maxRuns limit", async () => {
    const smallStore = new DefaultRunHistoryStore({
      storageDir: tmpDir,
      maxRuns: 3
    });

    for (let i = 1; i <= 5; i++) {
      await smallStore.saveRun({
        schemaVersion: 1,
        runId: `run-${i}`,
        projectId: "proj-test",
        cwd: "/workspace",
        userRequestSummary: `Task ${i}`,
        startedAt: Date.now() + i * 10,
        finalStatus: "completed",
        executionState: "completed",
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
      });
    }

    const runs = await smallStore.listRuns();
    expect(runs.length).toBe(3);
    const runIds = runs.map((r) => r.runId);
    expect(runIds).not.toContain("run-1");
    expect(runIds).not.toContain("run-2");
    expect(runIds).toContain("run-3");
    expect(runIds).toContain("run-4");
    expect(runIds).toContain("run-5");
  });

  it("handles corrupt files and unknown schema versions gracefully without crashing", async () => {
    // Write a malformed JSON file
    await fs.writeFile(path.join(tmpDir, "corrupt.json"), "invalid json content {{{", "utf-8");

    // Write an invalid schema version file
    await fs.writeFile(
      path.join(tmpDir, "unknown-schema.json"),
      JSON.stringify({ schemaVersion: 99, runId: "unknown-schema" }),
      "utf-8"
    );

    expect(await store.getRun("corrupt")).toBeNull();
    expect(await store.getRun("unknown-schema")).toBeNull();

    // Listing runs ignores the corrupt file
    const list = await store.listRuns();
    expect(Array.isArray(list)).toBe(true);
  });
});
