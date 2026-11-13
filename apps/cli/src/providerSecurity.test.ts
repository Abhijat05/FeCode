import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  ProviderProfileStore,
  InMemoryCredentialStore,
  DefaultRunHistoryStore,
  testProviderConnection,
  DefaultRunDiagnosticsManager,
  type DurableRunRecord
} from "@fecode/agent";
import { sanitizeReason } from "@fecode/models";

describe("Phase 5AJ Security Invariants — Strict Credential Protection", () => {
  let tmpDir: string;
  let providersPath: string;
  let historyDir: string;
  let credentialStore: InMemoryCredentialStore;
  let profileStore: ProviderProfileStore;

  const TEST_SECRET_KEY = "sk-super-secret-production-key-998877665544332211";
  const TEST_NVIDIA_KEY = "nvapi-secret-nvidia-token-abcdef1234567890";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-sec-test-"));
    providersPath = path.join(tmpDir, "providers.json");
    historyDir = path.join(tmpDir, "history");
    await fs.mkdir(historyDir, { recursive: true });

    credentialStore = new InMemoryCredentialStore();
    profileStore = new ProviderProfileStore(providersPath, credentialStore);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("Security Invariant 1: Persisted profile configuration NEVER contains raw API keys", async () => {
    await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI GPT-4o",
      model: "gpt-4o",
      apiKey: TEST_SECRET_KEY
    });

    const fileContent = await fs.readFile(providersPath, "utf-8");
    expect(fileContent).not.toContain(TEST_SECRET_KEY);

    const parsed = JSON.parse(fileContent);
    expect(parsed.profiles[0].apiKey).toBeUndefined();
    expect(parsed.profiles[0].secret).toBeUndefined();
    expect(parsed.profiles[0].credentialReference).toBeDefined();
    expect(parsed.profiles[0].credentialReference).not.toContain(TEST_SECRET_KEY);
  });

  it("Security Invariant 2: Connection testing errors NEVER leak API keys", async () => {
    const result = await testProviderConnection({
      providerId: "openai-compatible",
      model: "deepseek-ai/deepseek-v4.1-flash",
      baseUrl: "http://127.0.0.1:59999/v1",
      apiKey: TEST_NVIDIA_KEY
    });

    expect(result.success).toBe(false);
    expect(result.message).not.toContain(TEST_NVIDIA_KEY);
    if (result.error) {
      expect(result.error.reason).not.toContain(TEST_NVIDIA_KEY);
    }
  });

  it("Security Invariant 3: Thrown error classification strictly sanitizes secrets", () => {
    const errorWithSecret = new Error(
      `Failed to authenticate with key ${TEST_SECRET_KEY} against remote endpoint`
    );
    const sanitized = sanitizeReason(errorWithSecret.message);
    expect(sanitized).not.toContain(TEST_SECRET_KEY);
    expect(sanitized).toContain("[REDACTED_API_KEY]");
  });

  it("Security Invariant 4: Run history records NEVER store credentials", async () => {
    const historyStore = new DefaultRunHistoryStore({ storageDir: historyDir });

    const sensitiveRecord: DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-sec-test-1",
      projectId: "proj-sec",
      cwd: tmpDir,
      userRequestSummary: `Please use my key ${TEST_SECRET_KEY} to build the app`,
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

    await historyStore.saveRun(sensitiveRecord);

    const record = await historyStore.getRun("run-sec-test-1");
    expect(record).toBeDefined();
    expect(record?.userRequestSummary).not.toContain(TEST_SECRET_KEY);

    // Verify raw file on disk
    const files = await fs.readdir(historyDir);
    for (const f of files) {
      const diskContent = await fs.readFile(path.join(historyDir, f), "utf-8");
      expect(diskContent).not.toContain(TEST_SECRET_KEY);
    }
  });

  it("Security Invariant 5: Diagnostics summary strictly sanitizes credentials", () => {
    const diagManager = new DefaultRunDiagnosticsManager();
    diagManager.startRun({
      runId: "run-diag-sec-1",
      cwd: tmpDir,
      userRequest: `Authenticate using ${TEST_SECRET_KEY}`
    });

    const summary = diagManager.getRunSummary("run-diag-sec-1");
    expect(summary?.userRequestSummary).not.toContain(TEST_SECRET_KEY);
    expect(summary?.userRequestSummary).toContain("[REDACTED_API_KEY]");
  });

  it("Security Invariant 6: Deleting a profile safely cleans up its credential without affecting other profiles", async () => {
    const p1 = await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini 1",
      model: "gemini-2.5-flash",
      apiKey: TEST_SECRET_KEY
    });
    const p2 = await profileStore.saveProfile({
      providerId: "openai-compatible",
      displayName: "NVIDIA 2",
      model: "deepseek-ai/deepseek-v4.1-flash",
      apiKey: TEST_NVIDIA_KEY
    });

    expect(await credentialStore.get(p1.credentialReference!)).toBe(TEST_SECRET_KEY);
    expect(await credentialStore.get(p2.credentialReference!)).toBe(TEST_NVIDIA_KEY);

    // Delete p1
    await profileStore.deleteProfile(p1.id);

    // p1 credential is deleted
    expect(await credentialStore.get(p1.credentialReference!)).toBeNull();

    // p2 credential remains securely present
    expect(await credentialStore.get(p2.credentialReference!)).toBe(TEST_NVIDIA_KEY);
  });
});
