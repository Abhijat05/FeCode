import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type {
  Agent,
  AgentEvent,
  AgentInput,
  PersistedSessionData,
  SessionStore
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

  it("renders file edit approval specifically with '⚠ FeCode wants to edit a file'", async () => {
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
            path: "src/components/Header.tsx",
            diff: "--- src/components/Header.tsx\n+++ src/components/Header.tsx\n@@ -1,2 @@\n-old\n+new"
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
    expect(frame).toContain("⚠ FeCode wants to edit a file");
    expect(frame).toContain("src/components/Header.tsx");
    expect(frame).toContain("Changes:");
    expect(frame).toContain("+new");
  });

  it("renders plan creation and step lifecycle cleanly without chain-of-thought", async () => {
    const mockAgent = new MockAgent();

    mockAgent.runFn = async function* () {
      yield {
        type: "plan_created",
        plan: {
          id: "plan-1",
          goal: "Add authentication",
          currentStep: 0,
          steps: [
            { id: "step-1", description: "Inspect auth utils", status: "pending" },
            { id: "step-2", description: "Implement auth provider", status: "pending" }
          ]
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

    const { lastFrame, stdin } = render(
      <App agent={mockAgent} cwd={process.cwd()} sessionStore={mockStore} />
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
});
