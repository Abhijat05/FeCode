import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultReplanManager } from "./replanManager.js";
import { DefaultTaskPlanner } from "./planner.js";
import { createTaskPlan, transitionPlanStatus } from "./taskPlan.js";
import { DefaultTaskRiskPolicy } from "../policy/taskRiskPolicy.js";
import { DefaultRunDiagnosticsManager } from "../diagnostics/runDiagnosticsManager.js";
import { DefaultRunHistoryStore } from "../history/runHistoryStore.js";
import type { TaskPlan } from "./types.js";

describe("DefaultReplanManager — Phase 5R", () => {
  let tmpDir: string;
  let planner: DefaultTaskPlanner;
  let riskPolicy: DefaultTaskRiskPolicy;
  let diagnosticsManager: DefaultRunDiagnosticsManager;
  let historyStore: DefaultRunHistoryStore;
  let replanManager: DefaultReplanManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-replan-test-"));
    await fs.writeFile(
      path.join(tmpDir, "Button.tsx"),
      "export function Button() { return <button>Click</button>; }\n",
      "utf-8"
    );

    planner = new DefaultTaskPlanner();
    riskPolicy = new DefaultTaskRiskPolicy();
    diagnosticsManager = new DefaultRunDiagnosticsManager();
    historyStore = new DefaultRunHistoryStore({ storageDir: path.join(tmpDir, "history") });

    replanManager = new DefaultReplanManager({
      planner,
      executionPolicy: riskPolicy,
      diagnosticsManager,
      historyStore,
      maxReplanDepth: 3
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("Replanning Eligibility", () => {
    it("assesses a superseded plan as eligible for replanning", async () => {
      let plan = createTaskPlan({
        planId: "plan-stale-1",
        runId: "run-stale-1",
        userRequestSummary: "Update component",
        objective: "Modify Button",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Edit Button.tsx",
            objective: "Edit button",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: false,
            status: "pending"
          }
        ]
      });

      plan = transitionPlanStatus(plan, "superseded", "Target file changed externally");
      replanManager.registerPlan(plan);

      const assessment = await replanManager.prepareReplan("plan-stale-1", {
        cwd: tmpDir,
        reason: "stale_workspace"
      });

      expect(assessment.eligible).toBe(true);
      expect(assessment.previousPlanId).toBe("plan-stale-1");
      expect(assessment.requiresUserConfirmation).toBe(true);
      expect(assessment.replanDepth).toBe(1);
      expect(assessment.isLimitReached).toBe(false);
    });

    it("assesses a plan with a failed step as eligible for replanning", async () => {
      let plan = createTaskPlan({
        planId: "plan-failed-1",
        runId: "run-failed-1",
        userRequestSummary: "Fix bug",
        objective: "Fix bug in Button",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Modify Button.tsx",
            objective: "Edit button",
            type: "modify",
            dependencies: [],
            riskLevel: "normal",
            verificationRequired: true,
            status: "failed",
            error: "Syntax error during edit"
          }
        ]
      });

      plan = transitionPlanStatus(plan, "failed");
      replanManager.registerPlan(plan);

      const assessment = await replanManager.prepareReplan("plan-failed-1", {
        cwd: tmpDir,
        reason: "step_failed",
        failedStepId: "step-1"
      });

      expect(assessment.eligible).toBe(true);
      expect(assessment.affectedStepId).toBe("step-1");
      expect(assessment.requiresUserConfirmation).toBe(true);
    });

    it("enforces maxReplanDepth limit and flags limit_reached", async () => {
      const planAtMaxDepth = createTaskPlan({
        planId: "plan-depth-3",
        runId: "run-depth-3",
        userRequestSummary: "Deep task",
        objective: "Deep task",
        steps: [],
        replanDepth: 3,
        replanCount: 3,
        status: "superseded"
      });

      replanManager.registerPlan(planAtMaxDepth);

      const assessment = await replanManager.prepareReplan("plan-depth-3", {
        cwd: tmpDir,
        reason: "stale_workspace"
      });

      expect(assessment.eligible).toBe(false);
      expect(assessment.isLimitReached).toBe(true);
      expect(assessment.reason).toBe("REPLAN_LIMIT_REACHED");
    });
  });

  describe("Execution & New Plan Integrity", () => {
    it("generates a new plan with a distinct planId, parentPlanId, replanDepth, and status=ready", async () => {
      let oldPlan = createTaskPlan({
        planId: "plan-old-1",
        runId: "run-old-1",
        userRequestSummary: "Update component Button",
        objective: "Update Button component",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect Button.tsx",
            objective: "Read Button",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "completed"
          },
          {
            stepId: "step-2",
            order: 2,
            title: "Modify Button.tsx",
            objective: "Edit Button",
            type: "modify",
            dependencies: ["step-1"],
            riskLevel: "normal",
            verificationRequired: false,
            status: "failed",
            error: "File drift"
          }
        ],
        status: "failed"
      });

      oldPlan = transitionPlanStatus(oldPlan, "superseded", "File drift");
      replanManager.registerPlan(oldPlan);

      const result = await replanManager.executeReplan({
        runId: "run-new-1",
        previousPlanId: "plan-old-1",
        reason: "stale_workspace",
        explanation: "Button.tsx changed outside run",
        cwd: tmpDir,
        userRequest: "Update component Button",
        requestedBy: "user"
      });

      expect(result.status).toBe("created");
      expect(result.newPlanId).toBeDefined();
      expect(result.newPlanId).not.toBe("plan-old-1");
      expect(result.newPlan).toBeDefined();

      const newPlan = result.newPlan!;
      expect(newPlan.status).toBe("ready"); // Never auto-approved, never auto-executed
      expect(newPlan.parentPlanId).toBe("plan-old-1");
      expect(newPlan.replanDepth).toBe(1);
      expect(newPlan.replanReason).toBe("stale_workspace");
      expect(newPlan.replanCount).toBe(1);

      // Old plan remains immutable
      expect(oldPlan.status).toBe("superseded");
      expect(oldPlan.steps[0].status).toBe("completed");
      expect(oldPlan.steps[1].status).toBe("failed");
    });

    it("re-evaluates authoritative risk during replanning and never downgrades risk", async () => {
      const oldPlan = createTaskPlan({
        planId: "plan-risk-test",
        runId: "run-risk-test",
        userRequestSummary: "Modify package.json dependencies",
        objective: "Modify package.json dependencies",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect package.json",
            objective: "Read package.json",
            type: "inspect",
            dependencies: [],
            expectedFiles: ["package.json"],
            riskLevel: "low",
            verificationRequired: false,
            status: "failed"
          }
        ],
        status: "failed"
      });

      replanManager.registerPlan(oldPlan);

      const result = await replanManager.executeReplan({
        runId: "run-risk-new",
        previousPlanId: "plan-risk-test",
        reason: "step_failed",
        cwd: tmpDir,
        userRequest: "Modify package.json dependencies",
        requestedBy: "user"
      });

      expect(result.status).toBe("created");
      expect(result.newPlan).toBeDefined();

      const newPlan = result.newPlan!;
      const mutationStep = newPlan.steps.find((s) => s.type === "modify");
      if (mutationStep) {
        expect(["elevated", "critical"]).toContain(mutationStep.riskLevel);
      }
    });

    it("refuses to execute replan when max depth limit is reached", async () => {
      const planAtLimit = createTaskPlan({
        planId: "plan-limit-reached",
        runId: "run-limit",
        userRequestSummary: "Exhausted replans",
        objective: "Exhausted replans",
        steps: [],
        replanDepth: 3,
        status: "superseded"
      });

      replanManager.registerPlan(planAtLimit);

      const result = await replanManager.executeReplan({
        runId: "run-overflow",
        previousPlanId: "plan-limit-reached",
        reason: "stale_workspace",
        cwd: tmpDir,
        userRequest: "Try again",
        requestedBy: "user"
      });

      expect(result.status).toBe("limit_reached");
      expect(result.newPlanId).toBeUndefined();
    });
  });

  describe("Plan Lineage & History (`getPlanHistory`)", () => {
    it("reconstructs the complete lineage chain in reverse chronological order [PlanC, PlanB, PlanA]", async () => {
      const planA = createTaskPlan({
        planId: "plan-A",
        runId: "run-1",
        userRequestSummary: "Task A",
        objective: "Objective",
        steps: [],
        replanDepth: 0,
        status: "superseded"
      });

      const planB = createTaskPlan({
        planId: "plan-B",
        runId: "run-2",
        parentPlanId: "plan-A",
        userRequestSummary: "Task B",
        objective: "Objective",
        steps: [],
        replanDepth: 1,
        status: "superseded"
      });

      const planC = createTaskPlan({
        planId: "plan-C",
        runId: "run-3",
        parentPlanId: "plan-B",
        userRequestSummary: "Task C",
        objective: "Objective",
        steps: [],
        replanDepth: 2,
        status: "ready"
      });

      replanManager.registerPlan(planA);
      replanManager.registerPlan(planB);
      replanManager.registerPlan(planC);

      const history = await replanManager.getPlanHistory("plan-C");
      expect(history.length).toBe(3);
      expect(history[0].planId).toBe("plan-C");
      expect(history[1].planId).toBe("plan-B");
      expect(history[2].planId).toBe("plan-A");
    });

    it("safely detects cycles and avoids infinite loops (A -> B -> A)", async () => {
      const planA: TaskPlan = {
        ...createTaskPlan({
          planId: "plan-cyclic-A",
          runId: "run-1",
          userRequestSummary: "Task A",
          objective: "Objective",
          steps: [],
          status: "superseded"
        }),
        parentPlanId: "plan-cyclic-B"
      };

      const planB: TaskPlan = {
        ...createTaskPlan({
          planId: "plan-cyclic-B",
          runId: "run-2",
          userRequestSummary: "Task B",
          objective: "Objective",
          steps: [],
          status: "superseded"
        }),
        parentPlanId: "plan-cyclic-A"
      };

      replanManager.registerPlan(planA);
      replanManager.registerPlan(planB);

      const history = await replanManager.getPlanHistory("plan-cyclic-A");
      expect(history.length).toBe(2);
      expect(history[0].planId).toBe("plan-cyclic-A");
      expect(history[1].planId).toBe("plan-cyclic-B");
    });

    it("gracefully handles missing parent without fabricating missing plans", async () => {
      const planWithMissingParent = createTaskPlan({
        planId: "plan-orphan",
        runId: "run-orphan",
        parentPlanId: "plan-non-existent",
        userRequestSummary: "Task",
        objective: "Objective",
        steps: [],
        status: "ready"
      });

      replanManager.registerPlan(planWithMissingParent);

      const history = await replanManager.getPlanHistory("plan-orphan");
      expect(history.length).toBe(1);
      expect(history[0].planId).toBe("plan-orphan");
    });
  });
});
