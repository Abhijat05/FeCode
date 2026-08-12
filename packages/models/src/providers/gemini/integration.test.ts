import { describe, it, expect } from "vitest";
import { GeminiModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

const apiKey = process.env.GEMINI_API_KEY;

describe.runIf(Boolean(apiKey))(
  "GeminiModelProvider Real API Integration Tests",
  () => {
    const model = process.env.FE_MODEL || "gemini-2.5-flash";

    it("1. Basic text generation & streaming", async () => {
      const provider = new GeminiModelProvider({ apiKey, model });

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "What is React? Explain in 2 sentences." }]
      })) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text_delta");
      const completed = events.find((e) => e.type === "completed");

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(completed).toBeDefined();
      if (completed && completed.type === "completed") {
        expect(completed.usage?.inputTokens).toBeGreaterThan(0);
      }
    });

    it("2. Tool calling (search_files & read_file)", async () => {
      const provider = new GeminiModelProvider({ apiKey, model });

      const tools = [
        {
          name: "search_files",
          description: "Search text or code matches recursively in the project workspace.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Text query" }
            },
            required: ["query"]
          }
        },
        {
          name: "read_file",
          description: "Read contents of a source file.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" }
            },
            required: ["path"]
          }
        }
      ];

      // Turn 1: User asks where Dashboard is implemented
      const turn1Events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "Where is the Dashboard component implemented?" }],
        tools
      })) {
        turn1Events.push(event);
      }

      const toolCallEvent = turn1Events.find((e) => e.type === "tool_call");
      expect(toolCallEvent).toBeDefined();

      if (toolCallEvent && toolCallEvent.type === "tool_call") {
        expect(["search_files", "read_file"]).toContain(toolCallEvent.call.name);

        // Turn 2: Feed tool_result back to Gemini
        const turn2Events: ModelEvent[] = [];
        for await (const event of provider.generate({
          messages: [
            { role: "user", content: "Where is the Dashboard component implemented?" },
            {
              role: "assistant",
              toolCalls: [toolCallEvent.call]
            },
            {
              role: "tool",
              toolCallId: toolCallEvent.call.id,
              name: toolCallEvent.call.name,
              content: JSON.stringify({
                success: true,
                output: {
                  matches: [
                    { path: "src/components/Dashboard.tsx", line: 3, text: "export function Dashboard()" }
                  ]
                }
              })
            }
          ],
          tools
        })) {
          turn2Events.push(event);
        }

        const turn2Text = turn2Events.filter((e) => e.type === "text_delta");
        const turn2Done = turn2Events.find((e) => e.type === "completed");
        expect(turn2Text.length).toBeGreaterThan(0);
        expect(turn2Done).toBeDefined();
      }
    });

    it("3. Multi-turn conversation", async () => {
      const provider = new GeminiModelProvider({ apiKey, model });

      const turn1Events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "What is React?" }]
      })) {
        turn1Events.push(event);
      }

      const turn1Text = turn1Events
        .filter((e): e is { type: "text_delta"; content: string } => e.type === "text_delta")
        .map((e) => e.content)
        .join("");

      expect(turn1Text).toContain("React");

      const turn2Events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [
          { role: "user", content: "What is React?" },
          { role: "assistant", content: turn1Text },
          { role: "user", content: "What is its component model?" }
        ]
      })) {
        turn2Events.push(event);
      }

      const turn2Text = turn2Events
        .filter((e): e is { type: "text_delta"; content: string } => e.type === "text_delta")
        .map((e) => e.content)
        .join("");

      expect(turn2Text.length).toBeGreaterThan(0);
    });

    it("4. Error handling without credential leaks", async () => {
      const provider = new GeminiModelProvider({ apiKey: "invalid_key_12345", model });

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "Hi" }]
      })) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === "error") {
        expect(errorEvent.error.message).not.toContain("invalid_key_12345");
      }
    });

    it("5. Cancellation handling", async () => {
      const provider = new GeminiModelProvider({ apiKey, model });
      const controller = new AbortController();
      controller.abort();

      const events: ModelEvent[] = [];
      for await (const event of provider.generate(
        { messages: [{ role: "user", content: "Write a long essay about React" }] },
        controller.signal
      )) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === "error") {
        expect(errorEvent.error.message.toLowerCase()).toContain("abort");
      }
    });
  }
);
