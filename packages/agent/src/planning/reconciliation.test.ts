import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultFinalWorkspaceReconciler } from "./reconciliation.js";
import { createTaskPlan } from "./taskPlan.js";
import type { GitRepository } from "../git/types.js";
import type { WorkspaceFingerprint } from "../history/types.js";

describe("DefaultFinalWorkspaceReconciler — Phase 5U", () => {
  let tmpDir: string;
  let reconciler: DefaultFinalWorkspaceReconciler;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5u-recon-"));
    reconciler = new DefaultFinalWorkspaceReconciler();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("passes reconciliation when expected files are created and modified as planned", async () => {
    const file1 = path.join(tmpDir, "file1.ts");
    const file2 = path.join(tmpDir, "file2.ts");

    await fs.writeFile(file1, "created content");
    await fs.writeFile(file2, "modified content");

    const plan = createTaskPlan({
      planId: "plan-recon-1",
      runId: "run-recon-1",
      userRequestSummary: "Create and modify files",
      objective: "Reconcile success",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create file1.ts",
          objective: "Create file1",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["file1.ts"],
          intent: {
            type: "create_file",
            target: "file1.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Modify file2.ts",
          objective: "Modify file2",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["file2.ts"],
          intent: {
            type: "modify_file",
            target: "file2.ts",
            reason: "Modify file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const result = await reconciler.reconcile({
      runId: "run-recon-1",
      plan,
      cwd: tmpDir,
      verificationPassed: true
    });

    expect(result.consistent).toBe(true);
    expect(result.status).toBe("consistent");
    expect(result.missingFiles).toHaveLength(0);
    expect(result.unexpectedFiles).toHaveLength(0);
    expect(result.expectedFiles).toContain("file1.ts");
    expect(result.expectedFiles).toContain("file2.ts");
  });

  it("detects missing expected files and reports inconsistency", async () => {
    const plan = createTaskPlan({
      planId: "plan-missing",
      runId: "run-missing",
      userRequestSummary: "Create file that was not created",
      objective: "Detect missing",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create missing.ts",
          objective: "Create missing",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["missing.ts"],
          intent: {
            type: "create_file",
            target: "missing.ts",
            reason: "Create missing",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const result = await reconciler.reconcile({
      runId: "run-missing",
      plan,
      cwd: tmpDir,
      verificationPassed: true
    });

    expect(result.consistent).toBe(false);
    expect(result.status).toBe("inconsistent");
    expect(result.missingFiles).toContain("missing.ts");
    expect(result.failureReason).toContain("Missing expected files");
  });

  it("detects unexpected file modifications outside the execution plan", async () => {
    const expectedFile = path.join(tmpDir, "expected.ts");
    const unexpectedFile = path.join(tmpDir, "unexpected.ts");

    await fs.writeFile(expectedFile, "expected content");
    await fs.writeFile(unexpectedFile, "original content");

    // Fingerprint before run captured unexpected.ts
    const initialFingerprint: WorkspaceFingerprint = {
      capturedAt: Date.now() - 10000,
      fileFingerprints: {
        "unexpected.ts": {
          size: 16,
          mtimeMs: 1000
        }
      }
    };

    // Outside process modifies unexpected.ts
    await fs.writeFile(unexpectedFile, "modified content with much larger length");

    const plan = createTaskPlan({
      planId: "plan-unexpected",
      runId: "run-unexpected",
      userRequestSummary: "Only touch expected.ts",
      objective: "Touch expected",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create expected.ts",
          objective: "Create expected",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "completed",
          expectedFiles: ["expected.ts"],
          intent: {
            type: "create_file",
            target: "expected.ts",
            reason: "Create file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    const result = await reconciler.reconcile({
      runId: "run-unexpected",
      plan,
      cwd: tmpDir,
      initialFingerprint,
      verificationPassed: true
    });

    expect(result.consistent).toBe(false);
    expect(result.status).toBe("inconsistent");
    expect(result.unexpectedFiles).toContain("unexpected.ts");
    expect(result.failureReason).toContain("Unexpected workspace modifications");
  });

  it("detects git branch change during execution", async () => {
    const mockGit: GitRepository = {
      async isRepository(): Promise<boolean> {
        return true;
      },
      async getRoot(): Promise<string | null> {
        return tmpDir;
      },
      async getStatus(): Promise<import("../git/types.js").GitStatus> {
        return {
          isRepository: true,
          gitAvailable: true,
          root: tmpDir,
          branch: "feature-branch",
          files: [],
          ahead: 0,
          behind: 0,
          detached: false,
          hasConflicts: false
        } as unknown as import("../git/types.js").GitStatus;
      },
      async getBranch(): Promise<string> {
        return "feature-branch";
      },
      async getSnapshot(): Promise<import("../git/types.js").RepositorySnapshot> {
        return {
          capturedAt: new Date().toISOString(),
          root: tmpDir,
          branch: "feature-branch",
          files: []
        };
      }
    };

    const initialFingerprint: WorkspaceFingerprint = {
      capturedAt: Date.now() - 10000,
      gitBranch: "main" // Originally on main, now on feature-branch!
    };

    const plan = createTaskPlan({
      planId: "plan-branch",
      runId: "run-branch",
      userRequestSummary: "Branch check",
      objective: "Check branch",
      steps: []
    });

    const result = await reconciler.reconcile({
      runId: "run-branch",
      plan,
      cwd: tmpDir,
      initialFingerprint,
      gitRepository: mockGit,
      verificationPassed: true
    });

    expect(result.consistent).toBe(false);
    expect(result.branchChanged).toBe(true);
    expect(result.failureReason).toContain("Git branch changed");
  });

  it("fails reconciliation if verification failed", async () => {
    const plan = createTaskPlan({
      planId: "plan-verif-fail",
      runId: "run-verif-fail",
      userRequestSummary: "Verification fail",
      objective: "Check verif",
      steps: []
    });

    const result = await reconciler.reconcile({
      runId: "run-verif-fail",
      plan,
      cwd: tmpDir,
      verificationPassed: false
    });

    expect(result.consistent).toBe(false);
    expect(result.verificationPassed).toBe(false);
    expect(result.failureReason).toContain("Verification checks failed");
  });
});
