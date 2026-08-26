import { describe, it, expect } from "vitest";
import { createInitialUIState } from "./uiReducer.js";
import {
  selectApplicationShellProps,
  selectWorkspacePanelProps,
  selectTaskComposerProps,
  selectPlanViewerProps,
  selectApprovalPromptProps,
  selectRiskBannerProps,
  selectExecutionTimelineProps,
  selectRunStatusProps
} from "./components.js";

describe("Phase 5AC — UI Component Hierarchy & ViewModel Selectors", () => {
  it("projects ApplicationShellProps accurately from UIState", () => {
    const state = createInitialUIState({
      cwd: "/repo/fecode",
      runId: "run-shell-1",
      skills: ["git", "testing"],
      riskLevel: "elevated"
    });

    const props = selectApplicationShellProps(state);
    expect(props.status).toBe("idle");
    expect(props.cwd).toBe("/repo/fecode");
    expect(props.runId).toBe("run-shell-1");
    expect(props.skillsCount).toBe(2);
    expect(props.riskLevel).toBe("elevated");
    expect(props.hasPendingApproval).toBe(false);
  });

  it("projects WorkspacePanelProps accurately", () => {
    const state = createInitialUIState({
      cwd: "/repo",
      workspace: {
        cwd: "/repo",
        gitBranch: "feature/ui-shell",
        isGitDirty: true,
        modifiedFiles: ["src/index.ts"],
        untrackedFiles: ["notes.txt"],
        stagedFiles: [],
        recentChanges: [{ path: "src/index.ts", status: "modified" }],
        hasDrift: false
      }
    });

    const props = selectWorkspacePanelProps(state);
    expect(props.gitBranch).toBe("feature/ui-shell");
    expect(props.isGitDirty).toBe(true);
    expect(props.modifiedFiles).toEqual(["src/index.ts"]);
    expect(props.untrackedFiles).toEqual(["notes.txt"]);
  });

  it("projects TaskComposerProps and disables submit when executing or awaiting approval", () => {
    let state = createInitialUIState({ status: "executing" });
    let props = selectTaskComposerProps(state);
    expect(props.canSubmit).toBe(false);
    expect(props.isExecuting).toBe(true);

    state = createInitialUIState({
      status: "awaiting_step_approval",
      pendingApproval: {
        approvalId: "app-1",
        type: "step_checkpoint",
        runId: "run-1",
        riskLevel: "elevated",
        reason: "Elevated risk",
        affectedTargets: ["src/app.ts"],
        defaultDecision: "reject"
      }
    });
    props = selectTaskComposerProps(state);
    expect(props.canSubmit).toBe(false);
    expect(props.isExecuting).toBe(false);
  });

  it("projects PlanViewerProps with progress percentage calculation", () => {
    const state = createInitialUIState({
      activePlan: {
        planId: "plan-pv",
        runId: "run-pv",
        objective: "Build UI",
        userRequestSummary: "Build UI",
        status: "executing",
        createdAt: Date.now(),
        completedStepsCount: 2,
        totalStepsCount: 4,
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Step 1",
            objective: "Obj 1",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            status: "completed",
            verificationRequired: false
          },
          {
            stepId: "step-2",
            order: 2,
            title: "Step 2",
            objective: "Obj 2",
            type: "modify",
            dependencies: ["step-1"],
            riskLevel: "normal",
            status: "completed",
            verificationRequired: false
          },
          {
            stepId: "step-3",
            order: 3,
            title: "Step 3",
            objective: "Obj 3",
            type: "modify",
            dependencies: ["step-2"],
            riskLevel: "elevated",
            status: "in_progress",
            verificationRequired: false
          },
          {
            stepId: "step-4",
            order: 4,
            title: "Step 4",
            objective: "Obj 4",
            type: "verify",
            dependencies: ["step-3"],
            riskLevel: "low",
            status: "pending",
            verificationRequired: false
          }
        ]
      },
      activeStepId: "step-3"
    });

    const props = selectPlanViewerProps(state);
    expect(props.hasPlan).toBe(true);
    expect(props.completedCount).toBe(2);
    expect(props.totalCount).toBe(4);
    expect(props.progressPercent).toBe(50);
    expect(props.steps[2].isCurrent).toBe(true);
  });

  it("projects ApprovalPromptProps with distinct typeLabel", () => {
    const state = createInitialUIState({
      pendingApproval: {
        approvalId: "app-ckpt",
        type: "step_checkpoint",
        runId: "run-1",
        stepId: "step-2",
        checkpointId: "cp-7",
        riskLevel: "critical",
        reason: "Database drop",
        affectedTargets: ["db/schema.sql"],
        defaultDecision: "reject"
      }
    });

    const props = selectApprovalPromptProps(state);
    expect(props).toBeDefined();
    expect(props?.type).toBe("step_checkpoint");
    expect(props?.typeLabel).toBe("Mutation Checkpoint Approval");
    expect(props?.riskLevel).toBe("critical");
    expect(props?.defaultDecision).toBe("reject");
  });

  it("projects RiskBannerProps accurately", () => {
    const state = createInitialUIState({ riskLevel: "critical" });
    const props = selectRiskBannerProps(state);
    expect(props.riskLevel).toBe("critical");
    expect(props.isElevatedOrCritical).toBe(true);
    expect(props.badgeColor).toBe("magenta");
  });

  it("projects ExecutionTimelineProps and RunStatusProps accurately", () => {
    const state = createInitialUIState({
      status: "completed",
      runId: "run-complete-1",
      timeline: [
        {
          id: "tl-1",
          type: "run_event",
          title: "Run started",
          timestamp: 1000,
          status: "completed"
        }
      ]
    });

    const timelineProps = selectExecutionTimelineProps(state);
    expect(timelineProps.totalEvents).toBe(1);
    expect(timelineProps.hasActiveEvent).toBe(false);

    const runStatusProps = selectRunStatusProps(state);
    expect(runStatusProps.isCompleted).toBe(true);
    expect(runStatusProps.hasFailed).toBe(false);
    expect(runStatusProps.runId).toBe("run-complete-1");
  });
});
