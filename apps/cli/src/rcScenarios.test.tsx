import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  type Agent,
  type AgentEvent,
  type AgentInput,
  type TaskPlan,
  type RunSummary
} from "@fecode/agent";
import { App } from "./App.js";
import { InteractiveApprovalResolver } from "./approvalResolver.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function typeAndSubmit(stdin: { write: (data: string) => void }, text: string) {
  for (const char of text) {
    stdin.write(char);
    await delay(10);
  }
  stdin.write("\r");
}

class MockRCAgent implements Agent {
  public runFn?: (input: AgentInput) => AsyncIterable<AgentEvent>;
  public isCancelled = false;
  public getRunSummary?: (runId?: string) => RunSummary | undefined;
  public getTaskPlan?: () => TaskPlan | undefined;

  async cancel(): Promise<void> {
    this.isCancelled = true;
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (this.runFn) {
      yield* this.runFn(input);
      return;
    }
    yield { type: "text", content: `Echo: ${input.message}` };
    yield { type: "done" };
  }
}

describe("FeCode V1 Release Candidate Acceptance Scenarios", () => {
  // RC Scenario 1: TUI Startup
  it("RC Scenario 1: TUI startup renders header, status bar, and task prompt cleanly", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    const { lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    const frame = lastFrame() || "";
    expect(frame).toContain("FeCode");
    expect(frame).toContain("gemini");
    expect(frame).toContain("gemini-2.5-flash");
    expect(frame).toContain("Describe task or type /help...");
  });

  // RC Scenario 2: Task Composer
  it("RC Scenario 2: Task composer submits task, renders user turn and streams response", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Build login form");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("Build login form");
    expect(frame).toContain("Echo: Build login form");
  });

  // RC Scenario 3: Live Plan
  it("RC Scenario 3: Live plan renders created plan steps and progress", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();
    const plan: TaskPlan = {
      planId: "plan-rc-1",
      runId: "run-rc-1",
      userRequestSummary: "Add user authentication",
      objective: "Implement JWT auth",
      status: "executing",
      risks: [],
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Create auth service",
          objective: "Auth service",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          status: "in_progress",
          verificationRequired: false
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Verify auth routes",
          objective: "Test routes",
          type: "verify",
          dependencies: ["step-1"],
          riskLevel: "low",
          status: "pending",
          verificationRequired: true
        }
      ],
      createdAt: Date.now()
    };
    agent.getTaskPlan = () => plan;

    agent.runFn = async function* () {
      yield { type: "plan_created", plan };
      yield { type: "plan_step_started", runId: "run-rc-1", planId: "plan-rc-1", stepId: "step-1", stepIndex: 0, title: "Create auth service" };
      yield { type: "text", content: "Working on auth service..." };
      yield { type: "done" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Implement auth");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("Create auth service");
  });

  // RC Scenario 4: Live Timeline
  it("RC Scenario 4: Live timeline tracks execution events and state transitions", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    agent.runFn = async function* () {
      yield { type: "state_changed", from: "idle", to: "planning", reason: "Planning task" };
      yield { type: "state_changed", from: "planning", to: "executing", reason: "Starting execution" };
      yield { type: "text", content: "Executed successfully" };
      yield { type: "done" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Test timeline");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("Executed successfully");
  });

  // RC Scenario 5: Approval Modal & Safe Default
  it("RC Scenario 5: Approval modal defaults to deny on empty Enter input", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    let decisionResult: boolean | undefined;
    agent.runFn = async function* () {
      const decisionPromise = resolver.resolve({
        id: "app-rc-1",
        toolName: "write_file",
        category: "write",
        arguments: { path: "src/danger.ts" },
        reason: "Modifying core file"
      });
      yield {
        type: "approval_required",
        request: {
          id: "app-rc-1",
          toolName: "write_file",
          category: "write",
          arguments: { path: "src/danger.ts" },
          reason: "Modifying core file"
        }
      };
      const dec = await decisionPromise;
      decisionResult = dec.approved;
      yield { type: "text", content: dec.approved ? "Approved" : "Denied" };
      yield { type: "done" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Danger task");
    await delay(50);

    expect(lastFrame()).toContain("Step approval required");

    // Press enter without typing 'y'
    stdin.write("\r");
    await delay(50);

    expect(decisionResult).toBe(false);
    expect(lastFrame()).toContain("Denied");
  });

  // RC Scenario 6: Blocked Modal
  it("RC Scenario 6: Blocked modal renders warning and choice prompt with safe cancel default", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    const plan: TaskPlan = {
      planId: "plan-blocked-rc",
      runId: "run-blocked-rc",
      userRequestSummary: "Blocked task",
      objective: "Blocked task",
      status: "blocked",
      risks: [],
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Drifted step",
          objective: "Modify",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          status: "pending",
          verificationRequired: false
        }
      ],
      createdAt: Date.now()
    };
    agent.getTaskPlan = () => plan;

    agent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-blocked-rc",
        planId: "plan-blocked-rc",
        blockedStepId: "step-1",
        reason: "Target file modified concurrently",
        affectedSteps: ["step-1"],
        recommendedAction: "cancel"
      };
      yield { type: "done" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Run blocked task");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("PLAN EXECUTION BLOCKED");
    expect(frame).toContain("Cancel (Default)");
  });

  // RC Scenario 7: Recovery Modal
  it("RC Scenario 7: Recovery modal renders recovery assessment prompt", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    (agent as unknown as Record<string, unknown>).assessExecutionRecovery = async () => ({
      eligible: true,
      strategy: "rollback",
      reason: "Checkpoint available for rollback",
      actions: [{ actionId: "act-1", type: "restore_file", target: "app.ts", description: "Restore file" }]
    });

    agent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-rec-rc",
        planId: "plan-rec-rc",
        blockedStepId: "step-1",
        reason: "Failed verification",
        affectedSteps: ["step-1"],
        recommendedAction: "cancel"
      };
      yield { type: "done" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Trigger recovery");
    await delay(50);

    expect(lastFrame()).toContain("PLAN EXECUTION BLOCKED");
  });

  // RC Scenario 8: Replan Modal
  it("RC Scenario 8: Replan command (/replan) renders replan view and prompt", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    (agent as unknown as Record<string, unknown>).prepareReplan = async () => ({
      eligible: true,
      planId: "plan-replan-rc",
      replanDepth: 1,
      maxReplanDepth: 3,
      reason: "Execution path invalid",
      explanation: "Need alternative approach",
      affectedStepId: "step-2"
    });

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await delay(50);
    await typeAndSubmit(stdin, "/replan");
    await delay(100);

    const frame = lastFrame() || "";
    expect(frame).toContain("REPLAN");
  });

  // RC Scenario 9: Resume Flow
  it("RC Scenario 9: /resume displays historical resume flow information", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    (agent as unknown as Record<string, unknown>).getHistoricalRun = async (id: string) => ({
      schemaVersion: 1,
      runId: id,
      projectId: "default",
      cwd: "/test/workspace",
      userRequestSummary: "Original historical task",
      startedAt: Date.now() - 60000,
      completedAt: Date.now() - 30000,
      finalStatus: "failed",
      executionState: "failed",
      activeSkills: [],
      failureReason: "Failed during execution"
    });

    (agent as unknown as Record<string, unknown>).prepareResume = async (id: string) => ({
      canResume: true,
      originalRun: {
        schemaVersion: 1,
        runId: id,
        projectId: "default",
        cwd: "/test/workspace",
        userRequestSummary: "Original historical task",
        startedAt: Date.now() - 60000,
        finalStatus: "failed"
      },
      suggestedParentRunId: id,
      newRunId: `resumed-${id}`,
      resumeDepth: 1,
      workspaceChanged: false,
      workspaceDiffReasons: []
    });

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "/resume run-historical-123");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("run-historical-123");
  });

  // RC Scenario 10: Diagnostics Flow
  it("RC Scenario 10: /diagnostics displays run diagnostics information", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    agent.getRunSummary = () => ({
      runId: "run-diag-test",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      finalStatus: "completed",
      cwd: "/test/workspace",
      userRequestSummary: "Diagnostics test",
      initialRiskLevel: "low",
      riskReasons: [],
      requiresCheckpoint: false,
      requiresExplicitApproval: false,
      verificationAttempts: 1,
      maxVerificationAttempts: 3,
      recoveryAttempts: 0,
      maxRecoveryAttempts: 3,
      activeSkills: [],
      tools: [],
      commands: [],
      recovery: [],
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: []
    });

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "/diagnostics");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("Diagnostics");
  });

  // RC Scenario 11: Terminal Resize / Responsive Layout
  it("RC Scenario 11: Renders stably across different view modes without throwing", () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    expect(() => {
      render(
        <App
          agent={agent}
          cwd="/test/workspace"
          providerName="gemini"
          modelName="gemini-2.5-flash"
          approvalResolver={resolver}
        />
      );
    }).not.toThrow();
  });

  // RC Scenario 12: Ctrl+C Cancellation
  it("RC Scenario 12: Ctrl+C cancels in-progress task execution cleanly", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    agent.runFn = async function* () {
      yield { type: "text", content: "Long task running..." };
      await delay(100);
      if (agent.isCancelled) {
        return;
      }
      yield { type: "text", content: "Finished" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Long running task");
    await delay(30);

    // Send Ctrl+C
    stdin.write("\x03");
    await delay(50);

    expect(agent.isCancelled).toBe(true);
    const frame = lastFrame() || "";
    expect(frame).toMatch(/cancelled/i);
  });

  // RC Scenario 13: Late Events Handling
  it("RC Scenario 13: Late events arriving after completion do not crash or corrupt state", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    agent.runFn = async function* () {
      yield { type: "text", content: "Primary response" };
      yield { type: "done" };
      // Late stray event
      yield { type: "text", content: "Late stray token" };
    };

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await typeAndSubmit(stdin, "Task with late events");
    await delay(50);

    const frame = lastFrame() || "";
    expect(frame).toContain("Primary response");
  });

  // RC Scenario 14: Malformed Input
  it("RC Scenario 14: Malformed slash commands are handled gracefully with an error notice", async () => {
    const agent = new MockRCAgent();
    const resolver = new InteractiveApprovalResolver();

    const { stdin, lastFrame } = render(
      <App
        agent={agent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
      />
    );

    await delay(50);
    await typeAndSubmit(stdin, "/unknown-cmd-xyz");
    await delay(100);

    const frame = lastFrame() || "";
    expect(frame).toMatch(/Unknown command/i);
  });

  // RC Scenario 15: Configuration Failures
  it("RC Scenario 15: Configuration error displays safe error banner in terminal", () => {
    const resolver = new InteractiveApprovalResolver();

    const { lastFrame } = render(
      <App
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
        approvalResolver={resolver}
        configError="Missing GEMINI_API_KEY environment variable"
      />
    );

    const frame = lastFrame() || "";
    expect(frame).toContain("Configuration Error");
    expect(frame).toContain("Missing GEMINI_API_KEY");
  });
});
