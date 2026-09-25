import { describe, it, expect } from "vitest";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest
} from "../types.js";
import {
  FallbackModelProvider,
  type FallbackEvent
} from "./fallbackProvider.js";

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
    private readonly behavior: (attempt: number) => AsyncIterable<ModelEvent> | Promise<AsyncIterable<ModelEvent>>
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
    const iter = await this.behavior(this.attempts);
    for await (const ev of iter) {
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }
      yield ev;
    }
  }
}

async function* makeSuccessStream(text: string): AsyncIterable<ModelEvent> {
  yield { type: "text_delta", content: text };
  yield { type: "completed" };
}

async function* makeErrorStream(err: Error): AsyncIterable<ModelEvent> {
  yield { type: "error", error: err };
}

describe("FallbackModelProvider", () => {
  it("uses the primary provider when it succeeds without fallback", async () => {
    const providerA = new MockProvider("gemini", () => makeSuccessStream("Hello from Gemini"));
    const providerB = new MockProvider("openai", () => makeSuccessStream("Hello from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(0);
    expect(fallbackEvents.length).toBe(0);
    expect(events.some((e) => e.type === "text_delta" && e.content === "Hello from Gemini")).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("falls back to secondary provider when primary encounters 429 quota exhaustion", async () => {
    const quotaErr = Object.assign(new Error("Gemini quota exceeded (429 ResourceExhausted)"), { status: 429 });
    const providerA = new MockProvider("gemini", () => makeErrorStream(quotaErr));
    const providerB = new MockProvider("openai", () => makeSuccessStream("Hello from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(1);
    expect(fallbackEvents.length).toBe(1);
    expect(fallbackEvents[0].fromProvider).toBe("gemini");
    expect(fallbackEvents[0].toProvider).toBe("openai");
    expect(fallbackEvents[0].category).toBe("quota_exhaustion");
    expect(events.some((e) => e.type === "text_delta" && e.content === "Hello from OpenAI")).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("does NOT fall back on 401 Unauthorized authentication error", async () => {
    const authErr = Object.assign(new Error("Gemini API key is invalid or unauthorized"), { status: 401 });
    const providerA = new MockProvider("gemini", () => makeErrorStream(authErr));
    const providerB = new MockProvider("openai", () => makeSuccessStream("Hello from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(0);
    expect(fallbackEvents.length).toBe(0);
    expect(events.some((e) => e.type === "error" && e.error.message.includes("unauthorized"))).toBe(true);
  });

  it("does NOT fall back on 400 Bad Request error", async () => {
    const badReqErr = Object.assign(new Error("Invalid parameters provided"), { status: 400 });
    const providerA = new MockProvider("gemini", () => makeErrorStream(badReqErr));
    const providerB = new MockProvider("openai", () => makeSuccessStream("Hello from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(0);
    expect(fallbackEvents.length).toBe(0);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("chains through multiple providers if quota is exhausted sequentially", async () => {
    const quotaErr1 = Object.assign(new Error("Gemini quota exceeded (429)"), { status: 429 });
    const quotaErr2 = Object.assign(new Error("OpenAI quota exceeded (429)"), { status: 429, code: "insufficient_quota" });

    const providerA = new MockProvider("gemini", () => makeErrorStream(quotaErr1));
    const providerB = new MockProvider("openai", () => makeErrorStream(quotaErr2));
    const providerC = new MockProvider("ollama", () => makeSuccessStream("Hello from Ollama"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }, { provider: providerC }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(1);
    expect(providerC.attempts).toBe(1);
    expect(fallbackEvents.length).toBe(2);
    expect(fallbackEvents[0].fromProvider).toBe("gemini");
    expect(fallbackEvents[0].toProvider).toBe("openai");
    expect(fallbackEvents[1].fromProvider).toBe("openai");
    expect(fallbackEvents[1].toProvider).toBe("ollama");
    expect(events.some((e) => e.type === "text_delta" && e.content === "Hello from Ollama")).toBe(true);
  });

  it("terminates cleanly with error when all configured providers are exhausted", async () => {
    const quotaErr1 = Object.assign(new Error("Gemini 429"), { status: 429 });
    const quotaErr2 = Object.assign(new Error("OpenAI 429"), { status: 429 });

    const providerA = new MockProvider("gemini", () => makeErrorStream(quotaErr1));
    const providerB = new MockProvider("openai", () => makeErrorStream(quotaErr2));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(1);
    expect(providerB.attempts).toBe(1);
    expect(fallbackEvents.length).toBe(1);
    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    if (errEvent && errEvent.type === "error") {
      expect(errEvent.error.message).toContain("All configured model providers exhausted");
    }
  });

  it("retries transient 503 error on primary provider without triggering quota fallback", async () => {
    const netErr = Object.assign(new Error("Service Unavailable"), { status: 503 });
    let attempts = 0;
    const providerA = new MockProvider("gemini", () => {
      attempts++;
      if (attempts === 1) {
        return makeErrorStream(netErr);
      }
      return makeSuccessStream("Recovered after 503");
    });
    const providerB = new MockProvider("openai", () => makeSuccessStream("OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA, maxRetries: 1 }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(providerA.attempts).toBe(2);
    expect(providerB.attempts).toBe(0);
    expect(fallbackEvents.length).toBe(0);
    expect(events.some((e) => e.type === "text_delta" && e.content === "Recovered after 503")).toBe(true);
  });

  it("aborts immediately when AbortSignal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const providerA = new MockProvider("gemini", () => makeSuccessStream("Gemini"));
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }]
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] }, controller.signal)) {
      events.push(ev);
    }

    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
  });

  it("marks partialTextInterrupted as false when quota exhaustion occurs before any tokens (Situation A)", async () => {
    const quotaErr = Object.assign(new Error("Gemini quota exceeded (429)"), { status: 429 });
    const providerA = new MockProvider("gemini", () => makeErrorStream(quotaErr));
    const providerB = new MockProvider("openai", () => makeSuccessStream("Clean start from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(fallbackEvents.length).toBe(1);
    expect(fallbackEvents[0].partialTextInterrupted).toBe(false);
    expect(fallbackEvents[0].attemptId).toBeDefined();

    const fallbackYield = events.find((e) => e.type === "fallback");
    expect(fallbackYield).toBeDefined();
    if (fallbackYield && fallbackYield.type === "fallback") {
      expect(fallbackYield.partialTextInterrupted).toBe(false);
      expect(fallbackYield.attemptId).toBe(fallbackEvents[0].attemptId);
    }
  });

  it("marks partialTextInterrupted as true when quota exhaustion occurs mid-stream (Situation B)", async () => {
    const quotaErr = Object.assign(new Error("Gemini 429 mid-stream"), { status: 429 });
    async function* makeInterruptedStream(): AsyncIterable<ModelEvent> {
      yield { type: "text_delta", content: "Partial thoughts before dying..." };
      yield { type: "error", error: quotaErr };
    }

    const providerA = new MockProvider("gemini", () => makeInterruptedStream());
    const providerB = new MockProvider("openai", () => makeSuccessStream("Clean recovery from OpenAI"));

    const fallbackEvents: FallbackEvent[] = [];
    const fallbackProvider = new FallbackModelProvider({
      candidates: [{ provider: providerA }, { provider: providerB }],
      onFallback: (ev) => fallbackEvents.push(ev)
    });

    const events: ModelEvent[] = [];
    for await (const ev of fallbackProvider.generate({ messages: [] })) {
      events.push(ev);
    }

    expect(fallbackEvents.length).toBe(1);
    expect(fallbackEvents[0].partialTextInterrupted).toBe(true);
    expect(fallbackEvents[0].fromProvider).toBe("gemini");
    expect(fallbackEvents[0].toProvider).toBe("openai");

    const history = fallbackProvider.getAttemptHistory();
    expect(history.length).toBe(2);
    expect(history[0].providerId).toBe("gemini");
    expect(history[0].state).toBe("superseded");
    expect(history[0].tokensEmitted).toBe(1);
    expect(history[1].providerId).toBe("openai");
    expect(history[1].state).toBe("completed");
  });
});

