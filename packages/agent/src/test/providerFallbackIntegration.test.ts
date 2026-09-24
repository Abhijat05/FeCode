import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../runtime.js";
import { FallbackModelProvider } from "@fecode/models";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest
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
    private readonly handler: (attempt: number) => AsyncIterable<ModelEvent>
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
    for await (const ev of this.handler(this.attempts)) {
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }
      yield ev;
    }
  }
}

async function* streamText(text: string): AsyncIterable<ModelEvent> {
  yield { type: "text_delta", content: text };
  yield { type: "completed" };
}

async function* streamError(err: Error): AsyncIterable<ModelEvent> {
  yield { type: "error", error: err };
}

describe("Provider Auto-Fallback Integration", () => {
  it("automatically falls back to secondary provider on 429 quota exhaustion and completes run", async () => {
    const quotaErr = Object.assign(
      new Error("Gemini quota exceeded (429 ResourceExhausted). Key: AIzaSy1234567890abcdef1234567890abcdef"),
      { status: 429 }
    );

    const primary = new MockProvider("gemini", () => streamError(quotaErr));
    const fallback = new MockProvider("openai", () => streamText("Here is the answer from OpenAI"));

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Hello", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(primary.attempts).toBe(1);
    expect(fallback.attempts).toBe(1);

    // Verify provider_fallback_attempt event was emitted
    const fallbackEv = events.find((e) => e.type === "provider_fallback_attempt");
    expect(fallbackEv).toBeDefined();
    if (fallbackEv && fallbackEv.type === "provider_fallback_attempt") {
      expect(fallbackEv.fromProvider).toBe("gemini");
      expect(fallbackEv.toProvider).toBe("openai");
      expect(fallbackEv.attempt).toBe(1);
    }

    // Verify response from fallback provider was received
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.map((t) => (t as { content: string }).content).join("")).toContain("Here is the answer from OpenAI");

    // Verify run status
    expect(runtime.getRunSummary()?.finalStatus).toBe("completed");

    // Verify diagnostics recorded fallback decision cleanly with sanitized reason
    const summary = runtime.getRunSummary();
    expect(summary?.fallbackCount).toBe(1);
    expect(summary?.lastUsedProvider).toBe("openai");
    expect(summary?.fallbackEvents?.[0].fromProvider).toBe("gemini");
    expect(summary?.fallbackEvents?.[0].toProvider).toBe("openai");
    expect(summary?.fallbackEvents?.[0].reason).not.toContain("AIzaSy1234567890abcdef1234567890abcdef");
    expect(summary?.fallbackEvents?.[0].reason).toContain("[REDACTED_API_KEY]");
  });

  it("does not fall back on authentication (401) errors and marks run failed immediately", async () => {
    const authErr = Object.assign(
      new Error("Gemini API key is invalid or unauthorized"),
      { status: 401 }
    );

    const primary = new MockProvider("gemini", () => streamError(authErr));
    const fallback = new MockProvider("openai", () => streamText("Should never be reached"));

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: fallback }]
    });

    const runtime = new AgentRuntime(fallbackModel);

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Hello", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(primary.attempts).toBe(1);
    expect(fallback.attempts).toBe(0);

    const fallbackEv = events.find((e) => e.type === "provider_fallback_attempt");
    expect(fallbackEv).toBeUndefined();

    expect(runtime.getRunSummary()?.finalStatus).toBe("failed");
  });

  it("terminates with clear error when all configured fallback providers are exhausted", async () => {
    const quota1 = Object.assign(new Error("Gemini 429 ResourceExhausted"), { status: 429 });
    const quota2 = Object.assign(new Error("OpenAI 429 RateLimit"), { status: 429 });

    const primary = new MockProvider("gemini", () => streamError(quota1));
    const secondary = new MockProvider("openai", () => streamError(quota2));

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: secondary }]
    });

    const runtime = new AgentRuntime(fallbackModel);

    const events: AgentEvent[] = [];
    for await (const ev of runtime.run({ message: "Hello", cwd: process.cwd() })) {
      events.push(ev);
    }

    expect(primary.attempts).toBe(1);
    expect(secondary.attempts).toBe(1);

    expect(runtime.getRunSummary()?.finalStatus).toBe("failed");
    const errorEv = events.find((e) => e.type === "error");
    expect(errorEv).toBeDefined();
    if (errorEv && errorEv.type === "error") {
      expect(errorEv.error.message).toContain("All configured model providers exhausted");
    }
  });

  it("stops provider calls immediately when cancelled", async () => {
    const primary = new MockProvider("gemini", () => streamText("Slow text"));
    const secondary = new MockProvider("openai", () => streamText("Secondary"));

    const fallbackModel = new FallbackModelProvider({
      candidates: [{ provider: primary }, { provider: secondary }]
    });

    const runtime = new AgentRuntime(fallbackModel);

    const runPromise = (async () => {
      const evs: AgentEvent[] = [];
      for await (const ev of runtime.run({ message: "Hello", cwd: process.cwd() })) {
        evs.push(ev);
        await runtime.cancel();
      }
      return evs;
    })();

    await runPromise;
    expect(runtime.getRunSummary()?.finalStatus).toBe("cancelled");
  });
});
