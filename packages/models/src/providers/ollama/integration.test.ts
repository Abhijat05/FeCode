import { describe, it, expect } from "vitest";
import { OllamaModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

const shouldRunLive = Boolean(process.env.TEST_OLLAMA_LIVE);

describe.runIf(shouldRunLive)(
  "OllamaModelProvider Real API Integration Test",
  () => {
    it("connects to local Ollama server and streams response", async () => {
      const provider = new OllamaModelProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        model: process.env.FE_MODEL || "qwen2.5-coder"
      });

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "Reply with 'Hello Ollama!'" }]
      })) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text_delta");
      const completed = events.find((e) => e.type === "completed");

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(completed).toBeDefined();
    }, 30000);

    it("connects to local Ollama server and triggers tool call", async () => {
      const provider = new OllamaModelProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        model: process.env.FE_MODEL || "qwen2.5-coder"
      });

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "What is the weather in Tokyo? You must call the get_weather tool with location Tokyo." }],
        tools: [
          {
            name: "get_weather",
            description: "Get current weather for a city",
            inputSchema: {
              type: "object",
              properties: {
                location: { type: "string", description: "City name" }
              },
              required: ["location"]
            }
          }
        ]
      })) {
        events.push(event);
      }

      const toolCall = events.find((e) => e.type === "tool_call");
      const completed = events.find((e) => e.type === "completed");

      expect(completed).toBeDefined();
      expect(toolCall).toBeDefined();
      if (toolCall && toolCall.type === "tool_call") {
        expect(toolCall.call.name).toBe("get_weather");
      }
    }, 30000);
  }
);
