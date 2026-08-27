import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  Header,
  StatusBar,
  AppShell,
  TaskInput,
  PlanStep,
  PlanView,
  ExecutionView,
  ExecutionTimeline,
  ApprovalPrompt,
  RiskNotice,
  BlockedView,
  RecoveryView,
  ReplanView,
  ResumeView,
  DiagnosticsView,
  RunHistoryView,
  WorkspaceStatus,
  HelpView,
  ThinkingIndicator,
  MessageBubble,
  TurnView
} from "./index.js";

describe("TurnView", () => {
  it("renders user prompt and agent response with separator", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="Fix the tests"
        response="I will run the tests now."
        status="done"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
    expect(frame).toContain("You");
    expect(frame).toContain("Fix the tests");
    expect(frame).toContain("fecode");
    expect(frame).toContain("│");
    expect(frame).toContain("I will run the tests now.");
  });

  it("renders streaming placeholder while status is streaming and response is empty", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="Do something"
        response=""
        status="streaming"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("…");
  });

  it("renders error box for error status", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="Run tests"
        response=""
        status="error"
        error="Agent failed: timeout"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗ Error");
    expect(frame).toContain("Agent failed: timeout");
  });

  it("renders turn separator when isLast is false", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="Task 1"
        response="Done"
        status="done"
        isLast={false}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/─{3,}/);
  });

  it("does NOT render separator when isLast is true", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="Task 1"
        response="Done"
        status="done"
        isLast={true}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toMatch(/─{3,}/);
  });
});

describe("MessageBubble", () => {
  it("renders user bubble with You label and green glyph", () => {
    const { lastFrame } = render(
      <MessageBubble role="user" content="Refactor the login flow" />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
    expect(frame).toContain("You");
    expect(frame).toContain("Refactor the login flow");
  });

  it("renders agent bubble with fecode label and left gutter", () => {
    const { lastFrame } = render(
      <MessageBubble role="agent" content="I will start by..." />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("fecode");
    expect(frame).toContain("│");
    expect(frame).toContain("I will start by...");
  });

  it("renders streaming placeholder when content is empty and isStreaming", () => {
    const { lastFrame } = render(
      <MessageBubble role="agent" content="" isStreaming={true} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("…");
  });

  it("renders error box when error is provided", () => {
    const { lastFrame } = render(
      <MessageBubble role="agent" content="" error="Connection refused" />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗ Error");
    expect(frame).toContain("Connection refused");
  });
});

describe("ThinkingIndicator", () => {
  it("renders thinking label when active", () => {
    const { lastFrame } = render(<ThinkingIndicator isActive={true} label="Thinking" />);
    expect(lastFrame()).toContain("Thinking");
  });

  it("renders nothing when not active", () => {
    const { lastFrame } = render(<ThinkingIndicator isActive={false} />);
    expect(lastFrame()).toBe("");
  });
});

describe("Phase 5AD: Modular UI Components", () => {
  it("renders Header with project, model, cwd, status badge, and masked tokens", () => {
    const { lastFrame } = render(
      <Header
        projectName="fecode"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        cwd="/workspace/fecode"
        status="in_progress"
        sessionId="sess-1234-abcd"
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("FeCode project: fecode");
    expect(frame).toContain("Working directory: /workspace/fecode");
  });

  it("renders StatusBar with state and keyboard shortcuts", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" isGenerating={false} />
    );
    const frame = lastFrame();
    expect(frame).toContain("○ Ready for task");
    expect(frame).toContain("[c] Cancel [p] Plan [r] Runs [d] Diagnostics [?] Help");
  });

  it("renders StatusBar with spinner in executing and active states", () => {
    const { lastFrame } = render(
      <StatusBar status="executing" isGenerating={true} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/Executing task\.\.\./);
  });

  it("renders AppShell containing header, body, and footer slots", () => {
    const { lastFrame } = render(
      <AppShell
        header={<Header projectName="fecode" cwd="/test" status="idle" />}
        footer={<StatusBar status="idle" />}
      >
        <HelpView />
      </AppShell>
    );
    const frame = lastFrame();
    expect(frame).toContain("FeCode project: fecode");
    expect(frame).toContain("Available Commands:");
    expect(frame).toContain("○ Ready for task");
  });

  it("renders TaskInput with custom label and disabled indicator", () => {
    const { lastFrame } = render(
      <TaskInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        label="Custom Prompt"
        isDisabled={true}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Custom Prompt");
  });

  it("renders TaskInput with queued prompt and cancellation hint when disabled with pendingQuery", () => {
    const { lastFrame } = render(
      <TaskInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        isDisabled={true}
        pendingQuery="analyze bundle size"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[queued] analyze bundle size");
    expect(frame).toContain("Queued: analyze bundle size");
    expect(frame).toContain("Ctrl+C to cancel");
  });

  it("renders input separator when label is not shown in follow-up mode", () => {
    const { lastFrame } = render(
      <TaskInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        label={undefined}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("›");
    expect(frame).toMatch(/─{3,}/);
  });

  it("renders PlanStep with accessible symbols, dependencies, and risk badges", () => {
    const { lastFrame: completedFrame } = render(
      <PlanStep
        stepIndex={1}
        totalSteps={3}
        title="Inspect package.json"
        status="completed"
        verificationRequired={false}
      />
    );
    expect(completedFrame()).toContain("[1/3] ✓ Inspect package.json");

    const { lastFrame: blockedFrame } = render(
      <PlanStep
        stepIndex={2}
        totalSteps={3}
        title="Apply migrations"
        status="failed"
        dependencies={["step-1"]}
        verificationRequired={true}
        checkpointRequired={true}
        error="Migration failed: table exists"
      />
    );
    expect(blockedFrame()).toContain("[2/3] ✗ Apply migrations");
    expect(blockedFrame()).toContain("Deps: step-1");
    expect(blockedFrame()).toContain("[Checkpoint Required]");
    expect(blockedFrame()).toContain("[Verify Required]");
    expect(blockedFrame()).toContain("Error: Migration failed: table exists");
  });

  it("renders PlanView with metadata, objective, and step list", () => {
    const { lastFrame } = render(
      <PlanView
        planId="plan-auth-1"
        objective="Implement OAuth authentication"
        summary="User requested Google Auth integration"
        status="in_progress"
        completedCount={1}
        totalCount={3}
        steps={[
          {
            stepId: "step-1",
            order: 1,
            title: "Add dependencies",
            dependencies: [],
            verificationRequired: false,
            status: "completed"
          },
          {
            stepId: "step-2",
            order: 2,
            title: "Configure OAuth client",
            dependencies: ["step-1"],
            verificationRequired: true,
            status: "in_progress"
          }
        ]}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Plan: Implement OAuth authentication (plan-auth-1)");
    expect(frame).toContain("[1/3] Status: IN_PROGRESS");
    expect(frame).toContain("Add dependencies");
    expect(frame).toContain("Configure OAuth client");
  });

  it("renders ExecutionView streaming state and verification progress", () => {
    const { lastFrame } = render(
      <ExecutionView
        status="executing"
        runId="run-live-1"
        activeTool={{ toolName: "edit_file" }}
        activeVerification={{ command: "npm test", attempt: 1 }}
        streamedOutput="Generating auth handlers..."
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Run: run-live-1");
    expect(frame).toContain("edit_file");
    expect(frame).toContain("npm test");
    expect(frame).toContain("Generating auth handlers...");
  });

  it("renders ExecutionTimeline with bounded event list", () => {
    const { lastFrame } = render(
      <ExecutionTimeline
        items={[
          { id: "e1", timestamp: Date.now() - 1000, type: "run_started", title: "Run initialized" },
          { id: "e2", timestamp: Date.now() - 500, type: "tool_execution", title: "Read src/index.ts" },
          { id: "e3", timestamp: Date.now(), type: "verification", title: "Test suite passed" }
        ]}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Timeline");
    expect(frame).toContain("Run initialized");
    expect(frame).toContain("Read src/index.ts");
    expect(frame).toContain("Test suite passed");
  });

  it("renders ApprovalPrompt distinguishing tool permission and structured change reviews", () => {
    const { lastFrame } = render(
      <ApprovalPrompt
        toolName="edit_file"
        reason="Update database config"
        riskLevel="elevated"
        changeReview={{
          files: [
            {
              path: "src/db.ts",
              operation: "modified",
              additions: 3,
              deletions: 1,
              diff: "+const db = connect();\n-const db = null;"
            }
          ]
        }}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("⚠ FeCode wants to modify a file");
    expect(frame).toContain("Risk: ELEVATED");
    expect(frame).toContain("src/db.ts");
    expect(frame).toContain("Change: +3 -1");
    expect(frame).toContain("+const db = connect();");
    expect(frame).toContain("Allow? [y/N]:");
  });

  it("renders RiskNotice with reasons and checkpoint requirement", () => {
    const { lastFrame } = render(
      <RiskNotice
        level="elevated"
        reasons={["Touches package.json", "Modifies external dependency versions"]}
        requiresCheckpoint={true}
        requiresExplicitApproval={true}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("ELEVATED");
    expect(frame).toContain("Touches package.json");
    expect(frame).toContain("Checkpoint: REQUIRED");
  });

  it("renders BlockedView with choice actions and safe default [x]", () => {
    const { lastFrame } = render(
      <BlockedView
        planId="plan-blocked-99"
        stepInfo="2/4"
        reason="Lint error on line 42"
        affectedSteps={["step-2", "step-3"]}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("⚠ PLAN EXECUTION BLOCKED");
    expect(frame).toContain("Plan: plan-blocked-99");
    expect(frame).toContain("Step: 2/4");
    expect(frame).toContain("Lint error on line 42");
    expect(frame).toContain("[c] Continue");
    expect(frame).toContain("[r] Replan");
    expect(frame).toContain("[x] Cancel");
    expect(frame).toContain("Choice [x]:");
  });

  it("renders RecoveryView with outcome, blockers, and choice prompt", () => {
    const { lastFrame } = render(
      <RecoveryView
        strategy="repair"
        outcome="STILL_BLOCKED"
        blockers={["Type check failed: missing import 'auth'"]}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Recovery (repair)");
    expect(frame).toContain("Outcome: STILL_BLOCKED");
    expect(frame).toContain("Type check failed: missing import 'auth'");
    expect(frame).toContain("[r] Replan");
    expect(frame).toContain("[c] Re-check");
    expect(frame).toContain("[x] Cancel");
    expect(frame).toContain("Choice [x]:");
  });

  it("renders ReplanView with drift notice and non-automatic execution reminder", () => {
    const { lastFrame } = render(
      <ReplanView
        originalPlanId="plan-orig-1"
        newPlanId="plan-new-2"
        reason="Workspace changed externally"
        replanDepth={1}
        workspaceChanges={["Modified src/auth.ts"]}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("REPLAN REQUIRED");
    expect(frame).toContain("Original: plan-orig-1");
    expect(frame).toContain("New: plan-new-2");
    expect(frame).toContain("Workspace changed externally");
    expect(frame).toContain("Modified src/auth.ts");
    expect(frame).toContain("(Note: Creating a replacement plan does NOT automatically execute it.)");
    expect(frame).toContain("Create this replacement plan? [y/N]");
  });

  it("renders ResumeView with drift warning and non-reuse invariant reminder", () => {
    const { lastFrame } = render(
      <ResumeView
        runId="run-hist-fail"
        status="interrupted"
        duration="42s"
        originalRequest="Build auth module"
        workspaceDrift={["src/auth.ts was deleted"]}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Historical Run (Resume Request)");
    expect(frame).toContain("ID: run-hist-fail");
    expect(frame).toContain("Status: INTERRUPTED");
    expect(frame).toContain("Build auth module");
    expect(frame).toContain("src/auth.ts was deleted");
    expect(frame).toContain("(Historical approvals/checkpoints must never be reused.)");
    expect(frame).toContain("Resume this task as a new run? [y/N]");
  });

  it("renders DiagnosticsView with telemetry while stripping sensitive tokens", () => {
    const { lastFrame } = render(
      <DiagnosticsView
        summary={{
          runId: "run-diag-1",
          startedAt: Date.now() - 5000,
          completedAt: Date.now(),
          durationMs: 5000,
          finalStatus: "completed",
          cwd: "/workspace/fecode",
          userRequestSummary: "Build feature with secret key: sk-secret-12345-do-not-leak",
          activeSkills: ["brainstorming"],
          initialRiskLevel: "normal",
          verificationAttempts: 1,
          maxVerificationAttempts: 3,
          recoveryAttempts: 0,
          tools: [{ toolName: "read_file", calls: 4 }],
          commands: [{ command: "npm test", exitCode: 0 }]
        }}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Run: run-diag-1");
    expect(frame).toContain("completed");
    expect(frame).toContain("5s");
    expect(frame).toContain("read_file (4)");
    // Secrets must NOT be rendered
    expect(frame).not.toContain("sk-secret-12345-do-not-leak");
  });

  it("renders RunHistoryView with tabular listing of durable runs", () => {
    const { lastFrame } = render(
      <RunHistoryView
        runs={[
          {
            runId: "run-101",
            status: "completed",
            userRequestSummary: "Fix navigation bug",
            durationMs: 12000
          },
          {
            runId: "run-102",
            status: "failed",
            userRequestSummary: "Implement payment flow",
            durationMs: 45000
          }
        ]}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Recent Runs");
    expect(frame).toContain("run-101");
    expect(frame).toContain("✓ DONE");
    expect(frame).toContain("Fix navigation bug");
    expect(frame).toContain("run-102");
    expect(frame).toContain("✗ FAILED");
  });

  it("renders WorkspaceStatus with git branch and status details", () => {
    const { lastFrame } = render(
      <WorkspaceStatus
        cwd="/workspace/fecode"
        branch="feature/cli-ui"
        isClean={false}
        modifiedFiles={["src/App.tsx"]}
        untrackedFiles={["src/ui/Header.tsx"]}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Git & Workspace Status");
    expect(frame).toContain("Branch: feature/cli-ui | State: modified");
    expect(frame).toContain("src/App.tsx");
    expect(frame).toContain("src/ui/Header.tsx");
  });

  it("renders HelpView with complete command and shortcut reference", () => {
    const { lastFrame } = render(<HelpView />);
    const frame = lastFrame();
    expect(frame).toContain("Available Commands:");
    expect(frame).toContain("/plan");
    expect(frame).toContain("/runs");
    expect(frame).toContain("/debug");
    expect(frame).toContain("/git");
    expect(frame).toContain("/checkpoints");
    expect(frame).toContain("Keyboard Shortcuts:");
    expect(frame).toContain("Ctrl+C");
    expect(frame).toContain("[p]");
    expect(frame).toContain("[r]");
    expect(frame).toContain("[d] ");
    expect(frame).toContain("[?]");
    expect(frame).toContain("Esc");
  });
});
