import { describe, it, expect } from "vitest";
import type { Agent, AgentInput, AgentEvent } from "./index.js";

describe("@fecode/agent", () => {
  it("conforms to the Agent contract", async () => {
    class DummyAgent implements Agent {
      async *run(input: AgentInput): AsyncIterable<AgentEvent> {
        yield { type: "text", content: `Echo: ${input.message}` };
        yield { type: "done" };
      }
      async cancel(): Promise<void> {}
    }

    const agent = new DummyAgent();
    const events: AgentEvent[] = [];
    for await (const event of agent.run({ message: "Hello", cwd: "/test" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", content: "Echo: Hello" },
      { type: "done" }
    ]);
  });
});
