import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan } from "./taskPlan.js";
import type { AgentEvent } from "../index.js";
import type { FinalReconciliationResult } from "./types.js";
import type { ModelProvider } from "@fecode/models";

describe("AgentRuntime Controlled Recovery — Phase 5V Integration", () => {
  let tmpDir: string;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-5v-integration-"));
    const mockModel: ModelProvider = {
      id: "mock",
      capabilities: {
        streaming: true,
        toolCalling: false,
        vision: false,
        maxContextTokens: 4096
      },
      async *generate() {
        yield { type: "text_delta", content: "OK" };
        yield {
          type: "completed",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
        };
      }
    };
    runtime = new AgentRuntime(mockModel);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("exposes recovery manager and assesses recovery correctly", async () => {
    const recoveryMgr = runtime.getExecutionRecoveryManager();
    expect(recoveryMgr).toBeDefined();

    const plan = createTaskPlan({
      planId: "plan-5v-integ-1",
      runId: "run-5v-integ-1",
      userRequestSummary: "Create helper",
      objective: "Create helper.ts",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create src/helper.ts",
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: ["src/helper.ts"],
          intent: {
            type: "create_file",
            target: "src/helper.ts",
            reason: "Create helper file",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    // Set current plan
    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const reconResult: FinalReconciliationResult = {
      reconciliationId: "recon-integ-1",
      runId: "run-5v-integ-1",
      planId: "plan-5v-integ-1",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: ["src/helper.ts"],
      modifiedFiles: [],
      unexpectedFiles: [],
      missingFiles: ["src/helper.ts"],
      changedFiles: [],
      branchChanged: false,
      workspaceChanged: false,
      verificationPassed: true,
      consistent: false,
      failureReason: "Missing expected files: src/helper.ts"
    };

    const assessment = await runtime.assessExecutionRecovery(undefined, {
      cwd: tmpDir,
      reconciliationResult: reconResult
    });

    expect(assessment.eligible).toBe(true);
    expect(assessment.strategy).toBe("repair");
    expect(assessment.repairActions).toBeDefined();
    expect(assessment.repairActions?.length).toBe(1);
    expect(assessment.repairActions?.[0].target).toBe("src/helper.ts");
    expect(assessment.requiresExplicitApproval).toBe(true);
  });

  it("executes approved recovery and transitions state machine cleanly", async () => {
    const targetFile = "src/recovered_helper.ts";
    const plan = createTaskPlan({
      planId: "plan-5v-integ-2",
      runId: "run-5v-integ-2",
      userRequestSummary: "Create recovered helper",
      objective: "Create helper",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: `Create ${targetFile}`,
          objective: "Create file",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: false,
          status: "pending",
          expectedFiles: [targetFile],
          intent: {
            type: "create_file",
            target: targetFile,
            reason: "Create helper",
            requiresApproval: false,
            estimatedRisk: "normal"
          }
        }
      ]
    });

    (runtime as unknown as { currentPlan: typeof plan }).currentPlan = plan;

    const reconResult: FinalReconciliationResult = {
      reconciliationId: "recon-integ-2",
      runId: "run-5v-integ-2",
      planId: "plan-5v-integ-2",
      status: "inconsistent",
      checkedAt: Date.now(),
      expectedFiles: [targetFile],
      modifiedFiles: [],
      unexpectedFiles: [],
      missingFiles: [targetFile],
      changedFiles: [],
      branchChanged: false,
      workspaceChanged: false,
      verificationPassed: true,
      consistent: false,
      failureReason: `Missing expected files: ${targetFile}`
    };

    const assessment = await runtime.assessExecutionRecovery(undefined, {
      cwd: tmpDir,
      reconciliationResult: reconResult
    });

    const events: AgentEvent[] = [];
    for await (const ev of runtime.executeExecutionRecovery(assessment, {
      cwd: tmpDir,
      approved: true // Approved!
    })) {
      events.push(ev);
    }

    const started = events.find((e) => e.type === "recovery_started");
    const completed = events.find((e) => e.type === "recovery_completed");

    expect(started).toBeDefined();
    expect(completed).toBeDefined();

    // Verify disk state
    const exists = await fs
      .access(path.join(tmpDir, targetFile))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
