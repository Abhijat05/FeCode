import { describe, it, expect } from "vitest";
import { formatRunDiagnostics } from "./formatter.js";
import type { RunSummary } from "./types.js";

describe("formatRunDiagnostics — Phase 5M", () => {
  it("formats a completed run summary cleanly", () => {
    const summary: RunSummary = {
      runId: "run-fmt-1",
      startedAt: Date.now() - 4200,
      completedAt: Date.now(),
      durationMs: 4200,
      finalStatus: "completed",
      cwd: "/workspace/fecode",
      userRequestSummary: "Add user profile component",
      activeSkills: ["react", "frontend-design"],
      initialRiskLevel: "normal",
      riskReasons: ["1 file modified"],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 1,
      tools: [
        {
          toolName: "read_file",
          callId: "call-1",
          startedAt: Date.now() - 4000,
          completedAt: Date.now() - 3950,
          durationMs: 50,
          success: true
        },
        {
          toolName: "write_file",
          callId: "call-2",
          startedAt: Date.now() - 3500,
          completedAt: Date.now() - 3400,
          durationMs: 100,
          success: true
        }
      ],
      commands: [
        {
          command: "npm test",
          attempt: 1,
          startedAt: Date.now() - 2000,
          completedAt: Date.now() - 500,
          durationMs: 1500,
          exitCode: 0,
          succeeded: true
        }
      ],
      files: {
        modified: [],
        created: ["src/Profile.tsx"],
        deleted: []
      },
      lifecycleTransitions: [
        { timestamp: 1, from: "idle", to: "planning", reason: "Init" },
        { timestamp: 2, from: "planning", to: "executing", reason: "Tools" },
        { timestamp: 3, from: "executing", to: "verifying", reason: "Verify" },
        { timestamp: 4, from: "verifying", to: "completed", reason: "Done" }
      ]
    };

    const formatted = formatRunDiagnostics(summary);
    expect(formatted).toContain("Run: run-fmt-1");
    expect(formatted).toContain("Status: completed");
    expect(formatted).toContain("Duration: 4.2s");
    expect(formatted).toContain("Lifecycle:");
    expect(formatted).toContain("idle -> planning (Init)");
    expect(formatted).toContain("Tools:");
    expect(formatted).toContain("read_file        ✓ (50ms)");
    expect(formatted).toContain("write_file       ✓ (100ms)");
    expect(formatted).toContain("Verification Commands:");
    expect(formatted).toContain("attempt 1: npm test (exit 0) ✓ (1500ms)");
    expect(formatted).toContain("Skills:\n  react\n  frontend-design");
    expect(formatted).toContain("Risk:\n  level: normal");
    expect(formatted).toContain("Files:\n  created:  src/Profile.tsx");
  });

  it("formats a failed run summary with error codes", () => {
    const summary: RunSummary = {
      runId: "run-failed-1",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      durationMs: 1000,
      finalStatus: "failed",
      cwd: "/workspace",
      userRequestSummary: "Delete sensitive config",
      activeSkills: [],
      initialRiskLevel: "critical",
      riskReasons: ["Protected file"],
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
      failureReason: "Permission denied for protected file",
      failureCode: "PERMISSION_DENIED"
    };

    const formatted = formatRunDiagnostics(summary);
    expect(formatted).toContain("Status: failed");
    expect(formatted).toContain("Failure: [PERMISSION_DENIED] Permission denied for protected file");
  });
});
