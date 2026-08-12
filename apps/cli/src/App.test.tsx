import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { Agent, AgentEvent, AgentInput } from "@fecode/agent";
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
});
