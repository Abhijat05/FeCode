import { describe, it, expect } from "vitest";
import type { ModelProvider, ModelRequest, ModelEvent } from "./types.js";

describe("ModelProvider Types", () => {
  it("implements a mock provider emitting streaming text_delta and completed events", async () => {
    class MockProvider implements ModelProvider {
      id = "mock-provider";
      capabilities = {
        streaming: true,
        toolCalling: false,
        vision: false,
        maxContextTokens: 4096
      };

      async *generate(request: ModelRequest): AsyncIterable<ModelEvent> {
        for (const msg of request.messages) {
          yield { type: "text_delta", content: `Echo: ${msg.content}` };
        }
        yield {
          type: "completed",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
        };
      }
    }

    const provider = new MockProvider();
    expect(provider.id).toBe("mock-provider");
    expect(provider.capabilities.streaming).toBe(true);

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({
      messages: [{ role: "user", content: "Hello world" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", content: "Echo: Hello world" },
      {
        type: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      }
    ]);
  });
});
