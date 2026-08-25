import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  DefaultGitRepository,
  type Agent,
  type AgentEvent,
  type AgentInput,
  type PersistedSessionData,
  type SessionStore
} from "@fecode/agent";
import { App } from "./App.js";
import { InteractiveApprovalResolver } from "./approvalResolver.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function typeAndSubmit(stdin: { write: (data: string) => void }, text: string) {
  for (const char of text) {
    stdin.write(char);
    await delay(15);
  }
  stdin.write("\r");
}

class MockAgent implements Agent {
  public runFn?: (input: AgentInput) => AsyncIterable<AgentEvent>;
  public isCancelled = false;
  public getRunSummary?: (runId?: string) => import("@fecode/agent").RunSummary | undefined;
  public listHistoricalRuns?: () => Promise<import("@fecode/agent").DurableRunRecord[]>;
  public getHistoricalRun?: (id: string) => Promise<import("@fecode/agent").DurableRunRecord | null>;
  public prepareResume?: (
    id: string,
    cwd: string
  ) => Promise<import("@fecode/agent").ResumePreparation>;
  public prepareReplan?: (
    id?: string,
    opts?: { cwd: string }
  ) => Promise<import("@fecode/agent").ReplanAssessment>;
  public executeReplan?: (
    req: import("@fecode/agent").ReplanRequest
  ) => Promise<import("@fecode/agent").ReplanResult>;
  public getTaskPlan?: () => import("@fecode/agent").TaskPlan | undefined;
  public getPlanAdaptationAssessment?: () => import("@fecode/agent").PlanAdaptationAssessment | undefined;

  async *resumeRun(
    runId: string
  ): AsyncIterable<AgentEvent> {
    yield { type: "text", content: `Resumed output for ${runId}` };
    yield { type: "done" };
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (this.runFn) {
      yield* this.runFn(input);
      return;
    }

    yield { type: "text", content: `Response to: ${input.message}` };
    yield { type: "done" };
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
  }
}

describe("CLI App Component", () => {
  it("renders FeCode header and working directory", () => {
    const { lastFrame } = render(<App cwd="/test/dir" />);
    const output = lastFrame();
    expect(output).toContain("FeCode");
    expect(output).toContain("Working directory:");
    expect(output).toContain("/test/dir");
    expect(output).toContain("›");
  });

  it("passes user input to agent.run() and renders streamed response", async () => {
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* (input: AgentInput) {
      yield { type: "text", content: "React is " };
      yield { type: "text", content: `a JavaScript library for ${input.message.slice(8)}.` };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "What is React?");
    await delay(200);

    const output = lastFrame();
    expect(output).toContain("What is React?");
    expect(output).toContain("React is a JavaScript library for React?.");
  });

  it("renders error message cleanly when agent emits error", async () => {
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* () {
      yield { type: "error", error: new Error("Model request failed.") };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Fail prompt");
    await delay(200);

    const output = lastFrame();
    expect(output).toContain("Fail prompt");
    expect(output).toContain("✗ Model request failed.");
  });

  it("handles cancellation via cancel()", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield { type: "text", content: "Thinking long..." };
      await delay(500);
      yield { type: "done" };
    };

    const { stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Long task");
    await delay(100);

    // Send Ctrl+C while stream is running
    stdin.write("\x03");
    await delay(100);

    expect(mockAgent.isCancelled).toBe(true);
  });

  it("renders approval prompt and approves when user submits 'y'", async () => {
    const mockAgent = new MockAgent();
    const resolver = new InteractiveApprovalResolver();

    mockAgent.runFn = async function* () {
      yield {
        type: "approval_required",
        request: {
          id: "req-1",
          toolName: "mock_write",
          category: "write",
          arguments: { path: "test.txt", content: "hello" },
          reason: "Tool 'mock_write' requires approval for write permission."
        }
      };

      const decision = await resolver.resolve({
        id: "req-1",
        toolName: "mock_write",
        category: "write",
        arguments: { path: "test.txt", content: "hello" }
      });

      if (decision.approved) {
        yield {
          type: "tool_result",
          result: { success: true, output: { path: "test.txt" } },
          callId: "call-1"
        };
      } else {
        yield {
          type: "tool_result",
          result: { success: false, error: { message: "Denied", code: "PERMISSION_DENIED" } },
          callId: "call-1"
        };
      }
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} approvalResolver={resolver} cwd="/test" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Write test file");
    await delay(100);

    const promptFrame = lastFrame();
    expect(promptFrame).toContain("FeCode wants to use a tool");
    expect(promptFrame).toContain("Tool: mock_write");
    expect(promptFrame).toContain("Allow? [y/N]:");

    // Submit 'y'
    await typeAndSubmit(stdin, "y");
    await delay(200);

    const finalFrame = lastFrame();
    expect(finalFrame).toContain("✓ tool");
  });

  it("renders file edit approval specifically with structured change review", async () => {
    const mockAgent = new MockAgent();
    const resolver = new InteractiveApprovalResolver();

    mockAgent.runFn = async function* () {
      yield {
        type: "approval_required",
        request: {
          id: "req-edit-1",
          toolName: "edit_file",
          category: "write",
          arguments: {
            path: "src/components/Header.tsx"
          },
          changeReview: {
            files: [
              {
                path: "src/components/Header.tsx",
                operation: "modified",
                additions: 1,
                deletions: 1,
                diff: "--- src/components/Header.tsx\n+++ src/components/Header.tsx\n@@ -1,2 @@\n-old\n+new"
              }
            ],
            totalAddedLines: 1,
            totalRemovedLines: 1,
            truncated: false
          },
          reason: "File modification requires approval"
        }
      };

      const decision = await resolver.resolve({
        id: "req-edit-1",
        toolName: "edit_file",
        category: "write",
        arguments: { path: "src/components/Header.tsx" }
      });

      if (decision.approved) {
        yield {
          type: "tool_result",
          result: { success: true, output: { path: "src/components/Header.tsx" } },
          callId: "call-edit-1"
        };
      }
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} approvalResolver={resolver} cwd="/test" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Edit header");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("⚠ FeCode wants to modify a file");
    expect(frame).toContain("src/components/Header.tsx");
    expect(frame).toContain("Change:");
    expect(frame).toContain("+1 -1");
    expect(frame).toContain("+new");
  });

  it("renders plan creation and step lifecycle cleanly without chain-of-thought", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_created",
        plan: {
          planId: "plan-1",
          runId: "run-1",
          createdAt: Date.now(),
          userRequestSummary: "Add authentication",
          objective: "Add authentication",
          status: "ready",
          steps: [
            {
              stepId: "step-1",
              order: 1,
              title: "Inspect auth utils",
              objective: "Inspect auth utils",
              type: "inspect",
              dependencies: [],
              riskLevel: "low",
              verificationRequired: false,
              status: "pending"
            },
            {
              stepId: "step-2",
              order: 2,
              title: "Implement auth provider",
              objective: "Implement auth provider",
              type: "modify",
              dependencies: ["step-1"],
              riskLevel: "normal",
              verificationRequired: true,
              status: "pending"
            }
          ],
          risks: []
        }
      };
      yield { type: "plan_step_started", planId: "plan-1", stepId: "step-1", stepIndex: 0 };
      yield { type: "plan_step_completed", planId: "plan-1", stepId: "step-1", stepIndex: 0 };
      yield { type: "text", content: "Auth structure inspected." };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Add authentication");
    await delay(200);

    const frame = lastFrame();
    expect(frame).toContain("Plan: Add authentication");
    expect(frame).toContain("Inspect auth utils");
    expect(frame).toContain("Auth structure inspected.");
    // Verify no internal reasoning/chain-of-thought dumped
    expect(frame).not.toContain("chain-of-thought");
  });

  it("renders recovery status messages concisely in CLI UX", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield {
        type: "tool_call",
        call: { id: "call-read", name: "read_file", arguments: { path: "src/wrong.tsx" } }
      };
      yield {
        type: "tool_result",
        callId: "call-read",
        result: {
          success: false,
          error: { message: "File not found", code: "NOT_FOUND" }
        }
      };
      yield {
        type: "tool_call",
        call: { id: "call-edit", name: "edit_file", arguments: { path: "src/conflict.tsx" } }
      };
      yield {
        type: "tool_result",
        callId: "call-edit",
        result: {
          success: false,
          error: { message: "Context stale", code: "EDIT_CONFLICT" }
        }
      };
      yield {
        type: "tool_call",
        call: { id: "call-loop", name: "search_files", arguments: { query: "repeated" } }
      };
      yield {
        type: "tool_result",
        callId: "call-loop",
        result: {
          success: false,
          error: { message: "Loop detected", code: "REPEATED_CALL_LOOP" }
        }
      };
      yield { type: "text", content: "Recovery sequence complete." };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Trigger recovery statuses");
    await delay(200);

    const frame = lastFrame();
    expect(frame).toContain("⚠ read_file: File not found — searching again");
    expect(frame).toContain("⚠ edit_file: Edit conflict — refreshing file context");
    expect(frame).toContain("⚠ search_files: Repeated call loop detected — adapting strategy");
    expect(frame).toContain("Recovery sequence complete.");
  });

  it("renders completed task summary with changed files and verification commands", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield { type: "text", content: "Applied all changes." };
      yield {
        type: "task_summary",
        summary: {
          status: "completed",
          completedFiles: ["src/components/LoginButton.tsx"],
          verifiedCommands: ["npm test"],
          completedRequirements: ["Update login button text"],
          remainingRequirements: []
        }
      };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Complete login button");
    await delay(200);

    const frame = lastFrame();
    expect(frame).toContain("✓ Task completed");
    expect(frame).toContain("Changed:");
    expect(frame).toContain("src/components/LoginButton.tsx");
    expect(frame).toContain("Verified:");
    expect(frame).toContain("npm test");
  });

  it("renders blocked task summary with reason and remaining requirements", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield {
        type: "task_summary",
        summary: {
          status: "blocked",
          completedFiles: ["src/components/LoginButton.tsx"],
          verifiedCommands: [],
          completedRequirements: ["UI update"],
          remainingRequirements: ["Run integration tests"],
          blockedReason: "Permission denied for execute_command"
        }
      };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Blocked task");
    await delay(200);

    const frame = lastFrame();
    expect(frame).toContain("⚠ Task blocked");
    expect(frame).toContain("Reason:");
    expect(frame).toContain("Permission denied for execute_command");
    expect(frame).toContain("Remaining:");
    expect(frame).toContain("Run integration tests");
  });

  it("handles /help command", async () => {
    const mockAgent = new MockAgent();
    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/help");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Available commands:");
    expect(frame).toContain("/help");
    expect(frame).toContain("/status");
    expect(frame).toContain("/history");
    expect(frame).toContain("/tasks");
    expect(frame).toContain("/task");
    expect(frame).toContain("/sessions");
    expect(frame).toContain("/clear");
    expect(frame).toContain("/exit");
  });

  it("handles /status command without leaking secrets", async () => {
    const mockAgent = new MockAgent();
    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd="/test/workspace"
        providerName="gemini"
        modelName="gemini-2.5-flash"
      />
    );
    await delay(50);

    await typeAndSubmit(stdin, "/status");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("FeCode");
    expect(frame).toContain("Provider:");
    expect(frame).toContain("gemini");
    expect(frame).toContain("Model:");
    expect(frame).toContain("gemini-2.5-flash");
    expect(frame).toContain("Working directory:");
    expect(frame).toContain("/test/workspace");
    expect(frame).toContain("Session:");
    expect(frame).not.toContain("sk-");
    expect(frame).not.toContain("AIza");
  });

  it("handles /clear command", async () => {
    const mockAgent = new MockAgent();
    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "Hello turn");
    await delay(100);
    expect(lastFrame()).toContain("Response to: Hello turn");

    await typeAndSubmit(stdin, "/clear");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("✓ Conversation cleared");
    expect(frame).toContain("Session history remains available through:");
    expect(frame).not.toContain("Hello turn");
  });

  it("handles /history, /tasks, and /task commands", async () => {
    const mockAgent = new MockAgent();
    const initialSessionData: PersistedSessionData = {
      version: 1,
      sessionId: "session-hist-test",
      workingDirectory: process.cwd(),
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 2,
      status: "completed",
      completedTaskSummaries: [
        {
          taskIndex: 1,
          request: "Add login validation",
          status: "completed",
          completedFiles: ["src/components/LoginForm.tsx"],
          verifiedCommands: ["npm test"],
          completedRequirements: [],
          remainingRequirements: []
        },
        {
          taskIndex: 2,
          request: "Fix auth tests",
          status: "blocked",
          blockedReason: "Verification failed after 3 attempts",
          completedFiles: [],
          verifiedCommands: [],
          completedRequirements: [],
          remainingRequirements: ["Integration test suite"]
        }
      ],
      messages: []
    };

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={process.cwd()}
        initialSessionData={initialSessionData}
      />
    );
    await delay(50);

    // Test /history
    await typeAndSubmit(stdin, "/history");
    await delay(100);
    const histFrame = lastFrame();
    expect(histFrame).toContain("Session History");
    expect(histFrame).toContain("Fix auth tests");
    expect(histFrame).toContain("Add login validation");

    // Test /tasks
    await typeAndSubmit(stdin, "/tasks");
    await delay(100);
    const tasksFrame = lastFrame();
    expect(tasksFrame).toContain("Tasks");
    expect(tasksFrame).toContain("✓ 1  Add login validation");
    expect(tasksFrame).toContain("⚠ 2  Fix auth tests");

    // Test /task (no active task)
    await typeAndSubmit(stdin, "/task");
    await delay(100);
    expect(lastFrame()).toContain("Current Task");
    expect(lastFrame()).toContain("No active task.");

    // Test /task 1
    await typeAndSubmit(stdin, "/task 1");
    await delay(100);
    const t1Frame = lastFrame();
    expect(t1Frame).toContain("Task 1");
    expect(t1Frame).toContain("Status:");
    expect(t1Frame).toContain("completed");
    expect(t1Frame).toContain("Request:");
    expect(t1Frame).toContain("Add login validation");
    expect(t1Frame).toContain("Changed:");
    expect(t1Frame).toContain("src/components/LoginForm.tsx");

    // Test /task 99 (invalid)
    await typeAndSubmit(stdin, "/task 99");
    await delay(100);
    expect(lastFrame()).toContain("✗ Task not found: 99");
  });

  it("handles /exit command", async () => {
    let exited = false;
    const mockAgent = new MockAgent();
    const { stdin } = render(
      <App agent={mockAgent} cwd="/test" onExit={() => (exited = true)} />
    );
    await delay(50);

    await typeAndSubmit(stdin, "/exit");
    await delay(100);

    expect(exited).toBe(true);
  });

  it("handles /git command cleanly", async () => {
    const mockAgent = new MockAgent();
    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/git");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Git");
  });

  it("handles /checkpoints and /checkpoint commands", async () => {
    const mockAgent = new MockAgent();
    const mockGitRepo = new DefaultGitRepository(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));
    const isolatedStore = new (await import("@fecode/agent")).DefaultCheckpointStore(
      await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cli-cp-"))
    );
    const isolatedCpManager = new (await import("@fecode/agent")).DefaultCheckpointManager(
      isolatedStore,
      mockGitRepo
    );

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd="/test"
        gitRepository={mockGitRepo}
        checkpointManager={isolatedCpManager}
      />
    );
    await delay(50);

    // Test /checkpoints (empty)
    await typeAndSubmit(stdin, "/checkpoints");
    await delay(100);
    expect(lastFrame()).toContain("Checkpoints");

    // Test /checkpoint (create new checkpoint)
    await typeAndSubmit(stdin, "/checkpoint");
    await delay(100);
    expect(lastFrame()).toContain("Checkpoint created");

    // Test /recover status
    await typeAndSubmit(stdin, "/recover status");
    await delay(100);
    expect(lastFrame()).toContain("Recovery");

    // Test /recover preview without id
    await typeAndSubmit(stdin, "/recover preview");
    await delay(100);
    expect(lastFrame()).toContain("✗ Please specify a checkpoint ID");
  });

  it("handles /debug diagnostics slash command", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getRunSummary = () => ({
      runId: "test-run-123",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      durationMs: 1000,
      finalStatus: "completed",
      cwd: "/test",
      userRequestSummary: "Test request",
      activeSkills: [],
      initialRiskLevel: "low",
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
    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/debug");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Run: test-run-123");
    expect(frame).toContain("Status: completed");
  });

  it("handles /runs and /run commands", async () => {
    const mockAgent = new MockAgent();
    const sampleRun: import("@fecode/agent").DurableRunRecord = {
      schemaVersion: 1,
      runId: "run-cli-test-1",
      projectId: "proj-test",
      cwd: "/test",
      userRequestSummary: "Test CLI run history",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      durationMs: 5000,
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

    mockAgent.listHistoricalRuns = async () => [sampleRun];
    mockAgent.getHistoricalRun = async (id: string) =>
      id === "run-cli-test-1" ? sampleRun : null;

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    // /runs
    await typeAndSubmit(stdin, "/runs");
    await delay(100);
    expect(lastFrame()).toContain("run-cli-test-1");

    // /run <id>
    await typeAndSubmit(stdin, "/run run-cli-test-1");
    await delay(100);
    expect(lastFrame()).toContain("Project:   proj-test");
  });

  it("handles /resume <runId> command", async () => {
    const mockAgent = new MockAgent();
    mockAgent.prepareResume = async (id: string) => ({
      canResume: true,
      originalRun: {
        schemaVersion: 1,
        runId: id,
        projectId: "proj-test",
        cwd: "/test",
        userRequestSummary: "Fix authentication bug",
        startedAt: Date.now() - 10000,
        finalStatus: "failed",
        executionState: "failed",
        activeSkills: [],
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
        files: { modified: [], created: [], deleted: [] },
        lifecycleTransitions: []
      },
      suggestedParentRunId: id,
      newRunId: "run-resume-new-123",
      resumeDepth: 1,
      workspaceChanged: false,
      workspaceDiffReasons: [],
      reassessedRisk: {
        level: "normal",
        reasons: [],
        affectedFiles: 0,
        requiresCheckpoint: false,
        requiresExplicitApproval: false
      },
      reassessedSkills: [],
      requiresUserConfirmation: false,
      explanation: `Resuming task from run ${id}`
    });

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/resume run-orig-123");
    await delay(100);

    expect(lastFrame()).toContain("Resume Task Request:");
    expect(lastFrame()).toContain("run-orig-123");
    expect(lastFrame()).toContain("Resume this task as a new run? [y/N]");

    // Confirm with y
    await typeAndSubmit(stdin, "y");
    await delay(100);
    expect(lastFrame()).toContain("Resuming run run-orig-123");
    expect(lastFrame()).toContain("Resumed output for run-orig-123");
  });

  it("handles /resume cancellation when user inputs n", async () => {
    const mockAgent = new MockAgent();
    mockAgent.prepareResume = async (id: string) => ({
      canResume: true,
      originalRun: {
        schemaVersion: 1,
        runId: id,
        projectId: "proj-test",
        cwd: "/test",
        userRequestSummary: "Test cancellation",
        startedAt: Date.now() - 10000,
        finalStatus: "failed",
        executionState: "failed",
        activeSkills: [],
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
        files: { modified: [], created: [], deleted: [] },
        lifecycleTransitions: []
      },
      suggestedParentRunId: id,
      newRunId: "run-resume-cancelled-123",
      resumeDepth: 1,
      workspaceChanged: false,
      workspaceDiffReasons: [],
      reassessedRisk: {
        level: "normal",
        reasons: [],
        affectedFiles: 0,
        requiresCheckpoint: false,
        requiresExplicitApproval: false
      },
      reassessedSkills: [],
      requiresUserConfirmation: false,
      explanation: `Resuming task from run ${id}`
    });

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/resume run-to-cancel");
    await delay(100);
    expect(lastFrame()).toContain("Resume this task as a new run? [y/N]");

    await typeAndSubmit(stdin, "n");
    await delay(100);
    expect(lastFrame()).toContain("✗ Resume cancelled by user.");
  });

  it("handles /plan command displaying active plan details", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-test-123",
      runId: "run-test-1",
      createdAt: Date.now(),
      userRequestSummary: "Test plan request",
      objective: "Verify plan CLI rendering",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Inspect files",
          objective: "Read app.ts",
          type: "inspect",
          dependencies: [],
          riskLevel: "low",
          verificationRequired: false,
          status: "completed"
        },
        {
          stepId: "step-2",
          order: 2,
          title: "Modify app.ts",
          objective: "Apply code changes",
          type: "modify",
          dependencies: ["step-1"],
          riskLevel: "normal",
          verificationRequired: true,
          status: "pending"
        }
      ],
      risks: [],
      status: "ready"
    });

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/plan");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Task Execution Plan: plan-test-123");
    expect(frame).toContain("Verify plan CLI rendering");
    expect(frame).toContain("[1] Inspect files");
    expect(frame).toContain("completed ✓");
    expect(frame).toContain("[2] Modify app.ts");
  });

  it("handles /plan <runId> displaying historical run plan summary", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getRunSummary = () => ({
      runId: "run-hist-999",
      startedAt: Date.now() - 10000,
      finalStatus: "completed",
      cwd: "/test",
      userRequestSummary: "Fix bug",
      activeSkills: [],
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
      files: { modified: [], created: [], deleted: [] },
      lifecycleTransitions: [],
      planId: "plan-hist-999",
      planStatus: "completed",
      totalPlanSteps: 3,
      completedPlanSteps: 3,
      planSummary: "Historical task plan objective"
    });

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/plan run-hist-999");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Task Plan for Run: run-hist-999");
    expect(frame).toContain("plan-hist-999");
    expect(frame).toContain("3/3 completed");
  });

  it("handles unknown slash commands", async () => {
    const mockAgent = new MockAgent();
    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "/unknown_cmd");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("✗ Unknown command: /unknown_cmd. Type /help for available commands.");
  });

  it("safely ignores empty and whitespace-only input", async () => {
    let callCount = 0;
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* () {
      callCount++;
      yield { type: "text", content: "Response" };
      yield { type: "done" };
    };

    const { stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "");
    await delay(50);
    await typeAndSubmit(stdin, "   ");
    await delay(50);

    expect(callCount).toBe(0);
  });

  it("displays elevated risk indicator when prompt requests dependency changes", async () => {
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* () {
      yield { type: "text", content: "Dependencies updated." };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(<App agent={mockAgent} cwd="/test" />);
    await delay(50);

    await typeAndSubmit(stdin, "npm install axios and configure it");
    await delay(100);

    const frame = lastFrame();
    expect(frame).toContain("Elevated-risk task");
    expect(frame).toContain("Checkpoint required");
  });

  it("handles /sessions, /resume, and /delete-session commands", async () => {
    const mockAgent = new MockAgent();

    // Mock SessionStore
    const savedSessions = new Map<string, PersistedSessionData>();
    savedSessions.set("session-demo-1", {
      version: 1,
      sessionId: "session-demo-1",
      workingDirectory: process.cwd(),
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 2,
      status: "completed",
      completedTaskSummaries: [
        {
          taskIndex: 1,
          request: "Previous task 1",
          status: "completed",
          completedFiles: [],
          verifiedCommands: [],
          completedRequirements: [],
          remainingRequirements: []
        }
      ],
      messages: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" }
      ]
    });
    savedSessions.set("session-missing-dir", {
      version: 1,
      sessionId: "session-missing-dir",
      workingDirectory: "/nonexistent/path/for/test",
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      status: "completed",
      completedTaskSummaries: [],
      messages: []
    });

    const mockStore: SessionStore = {
      save: async (session: PersistedSessionData) => {
        savedSessions.set(session.sessionId, session);
      },
      load: async (sessionId: string) => {
        const found = savedSessions.get(sessionId);
        if (!found) throw new Error(`Session not found: ${sessionId}`);
        return found;
      },
      list: async () => {
        return Array.from(savedSessions.values()).map((s) => ({
          sessionId: s.sessionId,
          workingDirectory: s.workingDirectory,
          provider: s.provider,
          model: s.model,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          taskCount: s.taskCount,
          status: s.status,
          latestTaskSummary: s.completedTaskSummaries?.[0]
        }));
      },
      delete: async (sessionId: string) => {
        return savedSessions.delete(sessionId);
      }
    };

    const mockGitRepo = new DefaultGitRepository(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={process.cwd()}
        sessionStore={mockStore}
        gitRepository={mockGitRepo}
      />
    );
    await delay(50);

    // Test /sessions
    await typeAndSubmit(stdin, "/sessions");
    await delay(100);
    expect(lastFrame()).toContain("Saved Sessions");
    expect(lastFrame()).toContain("session-demo-1");
    expect(lastFrame()).toContain("gemini-2.5-flash");

    // Test /resume with missing directory
    await typeAndSubmit(stdin, "/resume session-missing-dir");
    await delay(100);
    expect(lastFrame()).toContain("⚠ Working directory no longer exists");

    // Test /resume session-demo-1
    await typeAndSubmit(stdin, "/resume session-demo-1");
    await delay(100);
    const resumeFrame = lastFrame();
    expect(resumeFrame).toContain("Resumed session");
    expect(resumeFrame).toContain("session-demo-1");
    expect(resumeFrame).toContain("Previous tasks:");
    expect(resumeFrame).toContain("✓ Previous task 1");

    // Test /delete-session session-demo-1
    await typeAndSubmit(stdin, "/delete-session session-demo-1");
    await delay(100);
    expect(lastFrame()).toContain("✓ Deleted session: session-demo-1");
  });

  it("renders plan execution orchestration events cleanly in CLI stream", async () => {
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* () {
      yield {
        type: "plan_execution_started",
        planId: "plan-test-1",
        totalSteps: 2
      };
      yield {
        type: "plan_step_started",
        planId: "plan-test-1",
        stepId: "step-1",
        stepIndex: 0,
        title: "Inspect codebase"
      };
      yield {
        type: "plan_step_completed",
        planId: "plan-test-1",
        stepId: "step-1",
        stepIndex: 0,
        durationMs: 150
      };
      yield {
        type: "plan_step_skipped",
        planId: "plan-test-1",
        stepId: "step-2",
        stepIndex: 1,
        reason: "Prerequisite not required"
      };
      yield {
        type: "plan_execution_completed",
        planId: "plan-test-1",
        completedSteps: 1,
        totalSteps: 2,
        durationMs: 300
      };
      yield { type: "done" };
    };

    const mockGitRepo = new DefaultGitRepository(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={process.cwd()}
        gitRepository={mockGitRepo}
      />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Execute approved plan");
    await delay(150);

    const frame = lastFrame();
    expect(frame).toContain("Plan approved. Executing 2 steps...");
    expect(frame).toContain("[1] Inspect codebase");
    expect(frame).toContain("EXECUTING");
    expect(frame).toContain("✓ COMPLETED");
    expect(frame).toContain("⊘ SKIPPED (Prerequisite not required)");
    expect(frame).toContain("✓ Plan completed (1/2 steps).");
  });

  it("handles /replan workflow with prompt and explicit user confirmation", async () => {
    const mockAgent = new MockAgent();
    mockAgent.prepareReplan = async () => ({
      eligible: true,
      reason: "stale_workspace",
      explanation: "Button.tsx changed externally",
      previousPlanId: "plan-stale-99",
      workspaceChanged: true,
      riskChanged: false,
      planStale: true,
      requiresUserConfirmation: true,
      replanDepth: 1,
      maxReplanDepth: 3,
      isLimitReached: false,
      previousPlan: {
        planId: "plan-stale-99",
        runId: "run-99",
        createdAt: Date.now(),
        userRequestSummary: "Update button style",
        objective: "Update button styling",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Inspect style",
            objective: "Read style",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "completed"
          }
        ],
        risks: [],
        status: "superseded"
      }
    });

    mockAgent.executeReplan = async () => ({
      previousPlanId: "plan-stale-99",
      newPlanId: "plan-adapted-100",
      status: "created",
      reason: "stale_workspace",
      createdAt: Date.now(),
      newPlan: {
        planId: "plan-adapted-100",
        runId: "run-replan-100",
        createdAt: Date.now(),
        userRequestSummary: "Update button style",
        objective: "Update button styling",
        steps: [
          {
            stepId: "step-1",
            order: 1,
            title: "Re-inspect style after external edit",
            objective: "Read style",
            type: "inspect",
            dependencies: [],
            riskLevel: "low",
            verificationRequired: false,
            status: "pending"
          }
        ],
        risks: [],
        status: "ready",
        parentPlanId: "plan-stale-99",
        replanDepth: 1
      }
    });

    const mockGitRepo = new DefaultGitRepository(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={process.cwd()}
        gitRepository={mockGitRepo}
      />
    );
    await delay(50);

    // 1. Run /replan
    await typeAndSubmit(stdin, "/replan");
    await delay(100);

    let frame = lastFrame();
    expect(frame).toContain("Replanning Assessment:");
    expect(frame).toContain("plan-stale-99");
    expect(frame).toContain("Button.tsx changed externally");
    expect(frame).toContain("Create a new execution plan using the current workspace? [y/N]");

    // 2. Confirm replan with 'y'
    await typeAndSubmit(stdin, "y");
    await delay(150);

    frame = lastFrame();
    expect(frame).toContain("✓ Created replacement plan: plan-adapted-100");
    expect(frame).toContain("Re-inspect style after external edit");
  });

  it("handles /replan cancellation when user responds 'n'", async () => {
    const mockAgent = new MockAgent();
    mockAgent.prepareReplan = async () => ({
      eligible: true,
      reason: "user_requested",
      explanation: "User requested replanning",
      previousPlanId: "plan-active-1",
      workspaceChanged: false,
      riskChanged: false,
      planStale: false,
      requiresUserConfirmation: true,
      replanDepth: 1,
      maxReplanDepth: 3,
      isLimitReached: false
    });

    const mockGitRepo = new DefaultGitRepository(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={process.cwd()}
        gitRepository={mockGitRepo}
      />
    );
    await delay(50);

    await typeAndSubmit(stdin, "/replan");
    await delay(100);

    let frame = lastFrame();
    expect(frame).toContain("Create a new execution plan using the current workspace? [y/N]");

    // Respond 'n'
    await typeAndSubmit(stdin, "n");
    await delay(100);

    frame = lastFrame();
    expect(frame).toContain("Replanning cancelled.");
  });

  it("renders execution feedback and step retries during plan execution", async () => {
    const mockAgent = new MockAgent();
    mockAgent.runFn = async function* () {
      yield {
        type: "execution_feedback_detected",
        runId: "run-fb-1",
        planId: "plan-fb-1",
        stepId: "step-1",
        feedbackId: "fb-1",
        kind: "tool_failure",
        severity: "warning",
        summary: "Syntax error on line 12, attempting retry",
        recommendedAction: "retry",
        timestamp: Date.now()
      };
      yield {
        type: "step_retry_started",
        runId: "run-fb-1",
        planId: "plan-fb-1",
        stepId: "step-1",
        attempt: 2,
        maxAttempts: 3,
        reason: "Syntax error on line 12",
        timestamp: Date.now()
      };
      yield {
        type: "step_retry_completed",
        runId: "run-fb-1",
        planId: "plan-fb-1",
        stepId: "step-1",
        attempt: 2,
        success: true,
        timestamp: Date.now()
      };
      yield { type: "done" };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Implement feature");
    await delay(200);

    const frame = lastFrame();
    expect(frame).toContain("⚠ Feedback: Syntax error on line 12, attempting retry");
    expect(frame).toContain("⟳ Retrying Step step-1 (attempt 2/3): Syntax error on line 12");
    expect(frame).toContain("✓ Step retry succeeded on attempt 2");
  });

  it("renders plan_blocked prompt and handles user choosing continue ('c')", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-blocked-1",
      runId: "run-blocked-1",
      createdAt: Date.now(),
      userRequestSummary: "Refactor auth",
      objective: "Refactor authentication flow",
      status: "blocked",
      steps: [
        {
          stepId: "step-1",
          order: 1,
          title: "Update auth middleware",
          objective: "Update middleware",
          type: "modify",
          dependencies: [],
          riskLevel: "normal",
          verificationRequired: true,
          status: "failed",
          failureReason: "Lint error in auth.ts"
        }
      ],
      risks: []
    });

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-blocked-1",
        planId: "plan-blocked-1",
        blockedStepId: "step-1",
        reason: "Lint error in auth.ts",
        affectedSteps: ["step-1"],
        recommendedAction: "replan",
        timestamp: Date.now()
      };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Run auth update");
    await delay(200);

    let frame = lastFrame();
    expect(frame).toContain("⚠ Plan execution blocked");
    expect(frame).toContain("Plan: plan-blocked-1");
    expect(frame).toContain("[c] Continue — resume incomplete steps after fresh safety checks");
    expect(frame).toContain("[r] Replan  — create a new plan from the current workspace");
    expect(frame).toContain("[x] Cancel  — stop execution");
    expect(frame).toContain("Choice [x]:");

    // Respond with 'c' to continue
    await typeAndSubmit(stdin, "c");
    await delay(150);

    frame = lastFrame();
    expect(frame).toContain("↻ Resuming plan plan-blocked-1");
  });

  it("renders plan_blocked prompt and handles user choosing replan ('r')", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-blocked-replan",
      runId: "run-blocked-replan",
      createdAt: Date.now(),
      userRequestSummary: "Refactor auth",
      objective: "Refactor authentication flow",
      status: "blocked",
      steps: [],
      risks: []
    });

    mockAgent.prepareReplan = async () => ({
      eligible: true,
      reason: "step_failed",
      previousPlanId: "plan-blocked-replan",
      workspaceChanged: false,
      riskChanged: false,
      planStale: true,
      requiresUserConfirmation: true,
      replanDepth: 1,
      maxReplanDepth: 5,
      isLimitReached: false
    });

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-blocked-replan",
        planId: "plan-blocked-replan",
        blockedStepId: "step-1",
        reason: "Verification failed",
        affectedSteps: ["step-1"],
        recommendedAction: "replan",
        timestamp: Date.now()
      };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Run task");
    await delay(200);

    let frame = lastFrame();
    expect(frame).toContain("⚠ Plan execution blocked");

    // Respond with 'r' to replan
    await typeAndSubmit(stdin, "r");
    await delay(150);

    frame = lastFrame();
    expect(frame).toContain("→ Existing plan preserved");
    expect(frame).toContain("→ Creating replacement plan");
    expect(frame).toContain("Replanning Assessment:");
  });

  it("renders plan_blocked prompt and handles user choosing cancel by default", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-blocked-2",
      runId: "run-blocked-2",
      createdAt: Date.now(),
      userRequestSummary: "Refactor database",
      objective: "Refactor database models",
      status: "blocked",
      steps: [],
      risks: []
    });

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-blocked-2",
        planId: "plan-blocked-2",
        blockedStepId: "step-1",
        reason: "Workspace drifted",
        affectedSteps: ["step-1"],
        recommendedAction: "replan",
        timestamp: Date.now()
      };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Run migration");
    await delay(200);

    let frame = lastFrame();
    expect(frame).toContain("⚠ Plan execution blocked");
    expect(frame).toContain("Plan: plan-blocked-2");
    expect(frame).toContain("[c] Continue — resume incomplete steps after fresh safety checks");
    expect(frame).toContain("[r] Replan  — create a new plan from the current workspace");
    expect(frame).toContain("[x] Cancel  — stop execution");

    // Respond with 'x' (or default) to cancel
    await typeAndSubmit(stdin, "x");
    await delay(150);

    frame = lastFrame();
    expect(frame).toContain("✓ Plan cancelled");
  });

  it("defaults invalid user input on blocked plan prompt to cancel", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-blocked-invalid",
      runId: "run-blocked-invalid",
      createdAt: Date.now(),
      userRequestSummary: "Refactor auth",
      objective: "Refactor auth flow",
      status: "blocked",
      steps: [],
      risks: []
    });

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_blocked",
        runId: "run-blocked-invalid",
        planId: "plan-blocked-invalid",
        blockedStepId: "step-1",
        reason: "Blocked step",
        affectedSteps: ["step-1"],
        recommendedAction: "cancel",
        timestamp: Date.now()
      };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Do auth");
    await delay(200);

    // Provide invalid choice string "invalid_choice"
    await typeAndSubmit(stdin, "invalid_choice");
    await delay(150);

    const frame = lastFrame();
    expect(frame).toContain("✓ Plan cancelled");
  });

  it("renders final_reconciliation_failed prompt with missing and unexpected files", async () => {
    const mockAgent = new MockAgent();
    mockAgent.getTaskPlan = () => ({
      planId: "plan-recon-cli",
      runId: "run-recon-cli",
      createdAt: Date.now(),
      userRequestSummary: "Create auth files",
      objective: "Auth files",
      status: "blocked",
      steps: [],
      risks: []
    });

    mockAgent.runFn = async function* () {
      yield {
        type: "final_reconciliation_failed",
        result: {
          reconciliationId: "recon-1",
          runId: "run-recon-cli",
          planId: "plan-recon-cli",
          status: "inconsistent",
          checkedAt: Date.now(),
          expectedFiles: ["src/auth.ts"],
          modifiedFiles: [],
          unexpectedFiles: ["unexpected.log"],
          missingFiles: ["src/auth.ts"],
          changedFiles: ["unexpected.log"],
          branchChanged: false,
          workspaceChanged: true,
          verificationPassed: true,
          consistent: false,
          failureReason: "Missing expected files: src/auth.ts"
        },
        timestamp: Date.now()
      };
    };

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd="/test/dir" />
    );
    await delay(50);

    await typeAndSubmit(stdin, "Run auth");
    await delay(200);

    let frame = lastFrame();
    expect(frame).toContain("⚠ Final workspace reconciliation failed");
    expect(frame).toContain("Missing expected files:");
    expect(frame).toContain("• src/auth.ts");
    expect(frame).toContain("Unexpected changes:");
    expect(frame).toContain("• unexpected.log");
    expect(frame).toContain("[c] Re-check workspace");
    expect(frame).toContain("[r] Replan");
    expect(frame).toContain("[x] Cancel");

    // Choose [c] to re-check
    await typeAndSubmit(stdin, "c");
    await delay(150);

    frame = lastFrame();
    expect(frame).toContain("↻ Resuming plan plan-recon-cli");
  });
});

