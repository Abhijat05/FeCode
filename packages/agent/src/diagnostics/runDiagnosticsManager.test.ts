import { describe, it, expect } from "vitest";
import { DefaultRunDiagnosticsManager } from "./runDiagnosticsManager.js";

describe("DefaultRunDiagnosticsManager — Phase 5M", () => {
  it("tracks a full run record lifecycle with timing and metadata", () => {
    const manager = new DefaultRunDiagnosticsManager();
    const runId = "run-test-1";

    manager.startRun({
      runId,
      cwd: "/workspace/project",
      userRequest: "Fix auth bugs with token sk-abcdef1234567890abcdef12345",
      riskLevel: "normal",
      riskReasons: ["1 file modified"],
      requiresCheckpoint: false,
      maxVerificationAttempts: 3
    });

    manager.recordSkills(runId, ["typescript", "security"]);
    manager.recordStateChange(runId, {
      timestamp: Date.now(),
      from: "idle",
      to: "planning",
      reason: "Started"
    });
    manager.recordStateChange(runId, {
      timestamp: Date.now(),
      from: "planning",
      to: "executing",
      reason: "Executing tools"
    });

    manager.recordToolStart(runId, "read_file", "call-1", "src/auth.ts");
    manager.recordToolComplete(runId, "call-1", true);

    manager.recordToolStart(runId, "edit_file", "call-2", "src/auth.ts");
    manager.recordFileChange(runId, "src/auth.ts", "modified");
    manager.recordToolComplete(runId, "call-2", true);

    manager.recordStateChange(runId, {
      timestamp: Date.now(),
      from: "executing",
      to: "verifying",
      reason: "Running test"
    });

    manager.recordVerificationStart(runId, "npm test", 1);
    manager.recordVerificationComplete(runId, "npm test", 1, true, 0, false);

    manager.recordStateChange(runId, {
      timestamp: Date.now(),
      from: "verifying",
      to: "completed",
      reason: "Completed"
    });

    const summary = manager.completeRun(runId, "completed");
    expect(summary).toBeDefined();
    expect(summary?.runId).toBe(runId);
    expect(summary?.finalStatus).toBe("completed");
    expect(summary?.activeSkills).toEqual(["typescript", "security"]);
    expect(summary?.files.modified).toEqual(["src/auth.ts"]);
    expect(summary?.tools.length).toBe(2);
    expect(summary?.tools[0].toolName).toBe("read_file");
    expect(summary?.tools[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(summary?.commands.length).toBe(1);
    expect(summary?.commands[0].succeeded).toBe(true);
    expect(summary?.durationMs).toBeGreaterThanOrEqual(0);

    // Security: ensure API key in request is redacted
    expect(summary?.userRequestSummary).not.toContain("sk-abcdef1234567890abcdef12345");
    expect(summary?.userRequestSummary).toContain("[REDACTED_API_KEY]");
  });

  it("returns defensive copies preventing external mutation of internal state", () => {
    const manager = new DefaultRunDiagnosticsManager();
    const runId = "run-defensive";

    manager.startRun({
      runId,
      cwd: "/workspace",
      userRequest: "Test request"
    });

    const summary1 = manager.getRunSummary(runId);
    expect(summary1).toBeDefined();
    if (summary1) {
      summary1.activeSkills.push("hacked-skill");
      summary1.files.modified.push("hacked-file.ts");
    }

    const summary2 = manager.getRunSummary(runId);
    expect(summary2?.activeSkills).toEqual([]);
    expect(summary2?.files.modified).toEqual([]);
  });

  it("safely handles unknown run IDs without throwing", () => {
    const manager = new DefaultRunDiagnosticsManager();
    expect(manager.getRunSummary("unknown-run-id")).toBeUndefined();
    expect(manager.getRunEvents("unknown-run-id")).toBeUndefined();
    expect(manager.getLatestRunSummary()).toBeUndefined();
    expect(manager.listRuns()).toEqual([]);
  });

  it("enforces bounded memory retention by evicting oldest runs", () => {
    const manager = new DefaultRunDiagnosticsManager({ maxRetainedRuns: 3 });

    manager.startRun({ runId: "run-1", cwd: "/w", userRequest: "Task 1" });
    manager.startRun({ runId: "run-2", cwd: "/w", userRequest: "Task 2" });
    manager.startRun({ runId: "run-3", cwd: "/w", userRequest: "Task 3" });
    manager.startRun({ runId: "run-4", cwd: "/w", userRequest: "Task 4" });

    const runs = manager.listRuns();
    expect(runs.length).toBe(3);
    expect(runs.map((r) => r.runId)).toEqual(["run-2", "run-3", "run-4"]);
    expect(manager.getRunSummary("run-1")).toBeUndefined();
  });
});
