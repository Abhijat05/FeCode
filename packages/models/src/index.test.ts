import { describe, it, expect } from "vitest";
import type { ModelProvider, ModelEvent } from "./index.js";

describe("@fecode/models exports", () => {
  it("instantiates ModelProvider interface correctly", async () => {
    class DummyProvider implements ModelProvider {
      id = "test-provider";
      capabilities = {
        streaming: true,
        toolCalling: true,
        vision: false,
        maxContextTokens: 8192
      };
      async *generate(): AsyncIterable<ModelEvent> {
        yield { type: "completed" };
      }
    }

    const provider: ModelProvider = new DummyProvider();
    expect(provider.id).toBe("test-provider");
    expect(provider.capabilities.streaming).toBe(true);

    const events: ModelEvent[] = [];
    for await (const event of provider.generate({ messages: [] })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "completed" }]);
  });
});
