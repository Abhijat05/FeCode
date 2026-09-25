import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../runtime.js";
import { FallbackModelProvider } from "@fecode/models";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ToolCall
} from "@fecode/models";
import type { AgentEvent } from "../index.js";

class MockProvider implements ModelProvider {
  public attempts = 0;
  public capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 32768
  };

  constructor(
    public readonly id: string,
    private readonly handler: (attempt: number, signal?: AbortSignal) => AsyncIterable<ModelEvent>
  ) {}

  async *generate(
    _request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    this.attempts++;
    if (signal?.aborted) {
      yield { type: "error", error: new Error("Request aborted") };
      return;
    }
    for await (const ev of this.handler(this.attempts, signal)) {
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }
      yield ev;
    }
  }
}

describe("Phase 5AI.6 — Provider Fallback Hardening & Mid-Stream Safety", () => {
  it("Situation A: failure before any model output cleanly switches to replacement provider without interruption marker", async () => {
    const quotaErr = Object.assign(new Error("Gemini quota 429"), { status: 429 });
    const primary = new MockProvider("gemini", async function* () {
      yield { type: "error", error: quotaErr };
    });
    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Clean answer from OpenAI" };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Situation A", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(primary.attempts).toBe(1);
    expect(fallback.attempts).toBe(1);

    const fallbackEv = events.find((e) => e.type === "provider_fallback_attempt");
    expect(fallbackEv).toBeDefined();
    if (fallbackEv && fallbackEv.type === "provider_fallback_attempt") {
      expect(fallbackEv.fromProvider).toBe("gemini");
      expect(fallbackEv.toProvider).toBe("openai");
      expect(fallbackEv.partialTextInterrupted).toBe(false);
      expect(fallbackEv.tokensDiscarded).toBe(0);
    }

    const messages = runtime.getState().messages;
    const assistantMsgs = messages.filter((m: ModelMessage) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content).toBe("Clean answer from OpenAI");
    expect(runtime.getRunSummary()?.finalStatus).toBe("completed");
  });

  it("Situation B: failure after partial text discards uncommitted tokens and conversation history contains only final generation", async () => {
    const quotaErr = Object.assign(new Error("Gemini quota 429 mid-stream"), { status: 429 });
    const primary = new MockProvider("gemini", async function* () {
      yield { type: "text_delta", content: "I am starting to answer this query but then..." };
      yield { type: "error", error: quotaErr };
    });
    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Authoritative and complete response from OpenAI." };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Situation B", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(primary.attempts).toBe(1);
    expect(fallback.attempts).toBe(1);

    const fallbackEv = events.find((e) => e.type === "provider_fallback_attempt");
    expect(fallbackEv).toBeDefined();
    if (fallbackEv && fallbackEv.type === "provider_fallback_attempt") {
      expect(fallbackEv.fromProvider).toBe("gemini");
      expect(fallbackEv.toProvider).toBe("openai");
      expect(fallbackEv.partialTextInterrupted).toBe(true);
      expect(fallbackEv.tokensDiscarded).toBeGreaterThan(0);
      expect(fallbackEv.attemptId).toBeDefined();
    }

    // Verify conversation history has ONLY Candidate 2's clean generation, NO concatenated duplicate text
    const messages = runtime.getState().messages;
    const assistantMsgs = messages.filter((m: ModelMessage) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content).toBe("Authoritative and complete response from OpenAI.");
    expect(assistantMsgs[0].content).not.toContain("I am starting to answer this query but then...");

    // Verify diagnostics recorded the midstream interruption and attempt history
    const summary = runtime.getRunSummary();
    expect(summary?.fallbackCount).toBe(1);
    expect(summary?.fallbackEvents?.[0].partialTextInterrupted).toBe(true);
    expect(summary?.fallbackEvents?.[0].tokensDiscarded).toBeGreaterThan(0);
    expect(summary?.providerAttempts).toBeDefined();
    expect(summary?.providerAttempts?.length).toBe(2);
    expect(summary?.providerAttempts?.[0].state).toBe("superseded");
    expect(summary?.providerAttempts?.[0].tokensEmitted).toBe(1);
    expect(summary?.providerAttempts?.[1].state).toBe("completed");
  });

  it("Situation C: failure during partial tool-call generation discards incomplete tool calls without executing or persisting them", async () => {
    let toolExecutionAttempted = false;
    const quotaErr = Object.assign(new Error("Gemini quota 429 during tool call"), { status: 429 });

    const partialCall: ToolCall = {
      id: "call-123",
      name: "run_shell",
      arguments: { command: "echo should_never_run" }
    };

    const primary = new MockProvider("gemini", async function* () {
      yield { type: "tool_call", call: partialCall };
      yield { type: "error", error: quotaErr };
    });

    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "OpenAI decides to answer directly without tools." };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    // Hook registry or check tool calls
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Situation C", cwd: process.cwd() })) {
      events.push(ev);
      if (ev.type === "tool_started" || ev.type === "tool_result") {
        toolExecutionAttempted = true;
      }
    }

    expect(toolExecutionAttempted).toBe(false);

    // Verify no tool messages in state history
    const messages = runtime.getState().messages;
    const toolMessages = messages.filter((m: ModelMessage) => m.role === "tool");
    expect(toolMessages.length).toBe(0);

    // Verify assistant message does NOT have orphaned toolCalls
    const assistantMsgs = messages.filter((m: ModelMessage) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].toolCalls).toBeUndefined();
    expect(assistantMsgs[0].content).toBe("OpenAI decides to answer directly without tools.");
  });

  it("Situation D: fallback is blocked at safe execution boundary if tools were already dispatched in current turn", async () => {
    const quotaErr = Object.assign(new Error("Gemini 429 after tool"), { status: 429 });

    let turn = 0;
    const primary = new MockProvider("gemini", async function* () {
      turn++;
      if (turn === 1) {
        // Emit tool call that succeeds
        yield {
          type: "tool_call",
          call: { id: "call-read", name: "read_file", arguments: { path: "package.json" } }
        };
        yield { type: "completed" };
      } else {
        // In turn 2 after tools executed, quota fails
        yield { type: "error", error: quotaErr };
      }
    });

    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "OpenAI completed response" };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Situation D", cwd: process.cwd() })) {
      events.push(ev);
    }

    // In turn 2, the primary provider failed and fell back cleanly without re-executing turn 1's tool
    const fallbackEv = events.find((e) => e.type === "provider_fallback_attempt");
    expect(fallbackEv).toBeDefined();

    // The tool was executed exactly once (in turn 1), not duplicated
    const toolResultEvents = events.filter((e) => e.type === "tool_result");
    expect(toolResultEvents.length).toBe(1);
    expect(toolResultEvents[0].callId).toBe("call-read");
  });

  it("Cancellation: immediately halts fallback chain when signal is aborted before fallback completes", async () => {
    const quotaErr = Object.assign(new Error("Gemini 429"), { status: 429 });
    const primary = new MockProvider("gemini", async function* () {
      yield { type: "error", error: quotaErr };
    });
    const secondary = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Should never emit" };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: secondary }]
    });

    const controller = new AbortController();
    controller.abort();

    const evs: ModelEvent[] = [];
    for await (const ev of fallbackModel.generate({ messages: [] }, controller.signal)) {
      evs.push(ev);
    }

    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("error");
    if (evs[0].type === "error") {
      expect(evs[0].error.message).toContain("aborted");
    }
  });

  it("Late event drop: strictly ignores any events arriving from superseded attempt", async () => {
    let cleanupCalled = false;
    const quotaErr = Object.assign(new Error("Gemini quota 429"), { status: 429 });

    const primary = new MockProvider("gemini", () => {
      let step = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<ModelEvent>> {
              step++;
              if (step === 1) {
                return { value: { type: "text_delta", content: "Initial fragment" }, done: false };
              }
              if (step === 2) {
                return { value: { type: "error", error: quotaErr }, done: false };
              }
              return { value: undefined, done: true };
            },
            async return(): Promise<IteratorResult<ModelEvent>> {
              cleanupCalled = true;
              return { value: undefined, done: true };
            }
          };
        }
      };
    });

    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Valid OpenAI response" };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Late Event", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(cleanupCalled).toBe(true);

    // Verify history and attempts reflect superseded state
    const history = fallbackModel.getAttemptHistory();
    expect(history.length).toBe(2);
    expect(history[0].providerId).toBe("gemini");
    expect(history[0].state).toBe("superseded");
    expect(history[1].providerId).toBe("openai");
    expect(history[1].state).toBe("completed");

    // Verify state.messages contains only the clean generation from fallback provider
    const messages = runtime.getState().messages;
    const assistantMsgs = messages.filter((m: ModelMessage) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content).toBe("Valid OpenAI response");
    expect(assistantMsgs[0].content).not.toContain("Initial fragment");
  });

  it("Security invariant: credentials are redacted from fallback reason, diagnostics, and attempt errors", async () => {
    const rawSecret = "AIzaSySecretApiKey1234567890abcdef123456";
    const quotaErr = Object.assign(
      new Error(`Gemini quota exhausted (429) for key ${rawSecret}`),
      { status: 429 }
    );

    const primary = new MockProvider("gemini", async function* () {
      yield { type: "error", error: quotaErr };
    });
    const fallback = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Safe response" };
      yield { type: "completed" };
    });

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Test Security", cwd: process.cwd() })) {
      events.push(ev);
    }

    // Check emitted events
    for (const ev of events) {
      const serialized = JSON.stringify(ev);
      expect(serialized).not.toContain(rawSecret);
    }

    // Check diagnostics
    const summary = runtime.getRunSummary();
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain(rawSecret);
    expect(serializedSummary).toContain("[REDACTED_API_KEY]");
  });

  it("Run resume: session interrupted or completed after mid-stream fallback can be resumed cleanly with uncorrupted history", async () => {
    const quotaErr = Object.assign(new Error("Gemini quota 429 mid-stream"), { status: 429 });

    const primary = new MockProvider("gemini", async function* () {
      yield { type: "text_delta", content: "Abandoned partial thoughts..." };
      yield { type: "error", error: quotaErr };
    });
    const secondary = new MockProvider("openai", async function* () {
      yield { type: "text_delta", content: "Clean response from OpenAI in Turn 1" };
      yield { type: "completed" };
    });

    const fallbackModel1 = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: secondary }]
    });

    const runtime1 = new AgentRuntime(fallbackModel1);
    for await (const _ev of runtime1.run({ message: "Turn 1 request", cwd: process.cwd(), sessionId: "sess-fallback-resume" })) {
      // drain
    }

    // Prepare session data from runtime1
    const runtime1State = runtime1.getState();
    const sessionData: import("../session/types.js").PersistedSessionData = {
      version: 1,
      sessionId: "sess-fallback-resume",
      workingDirectory: process.cwd(),
      provider: "fallback",
      model: "auto",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      status: "completed",
      completedTaskSummaries: [],
      messages: runtime1State.messages
    };

    // Verify sessionData.messages does not contain abandoned partial thoughts
    expect(sessionData.messages.some((m) => typeof m.content === "string" && m.content.includes("Abandoned partial thoughts..."))).toBe(false);
    expect(sessionData.messages.some((m) => typeof m.content === "string" && m.content.includes("Clean response from OpenAI in Turn 1"))).toBe(true);

    // Reconstruct into a new runtime (Resume)
    const providerTurn2 = new MockProvider("gemini", async function* () {
      yield { type: "text_delta", content: "Follow-up response in Turn 2" };
      yield { type: "completed" };
    });
    const fallbackModel2 = new FallbackModelProvider({
      candidates: [{ provider: providerTurn2 }]
    });

    const runtime2 = new AgentRuntime(fallbackModel2);
    runtime2.restoreSession(sessionData);

    const events2: AgentEvent[] = [];
    for await (const ev of runtime2.run({ message: "Turn 2 follow-up", cwd: process.cwd() })) {
      events2.push(ev);
    }

    expect(runtime2.getRunSummary()?.finalStatus).toBe("completed");
    const runtime2Messages = runtime2.getState().messages;
    expect(runtime2Messages.length).toBe(4); // Turn 1 user, Turn 1 assistant, Turn 2 user, Turn 2 assistant
    expect(runtime2Messages[1].content).toBe("Clean response from OpenAI in Turn 1");
    expect(runtime2Messages[3].content).toBe("Follow-up response in Turn 2");
  });
});

