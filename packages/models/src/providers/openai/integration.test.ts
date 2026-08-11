import { describe, it, expect } from "vitest";
import { OpenAIModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

const apiKey = process.env.OPENAI_API_KEY;

describe.runIf(Boolean(apiKey))(
  "OpenAIModelProvider Real API Integration Test",
  () => {
    it("connects to real OpenAI API and streams response", async () => {
      const provider = new OpenAIModelProvider({
        apiKey,
        model: process.env.FE_MODEL || "gpt-4o-mini"
      });

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [{ role: "user", content: "Reply with 'Hello FeCode!'" }]
      })) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text_delta");
      const completed = events.find((e) => e.type === "completed");

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(completed).toBeDefined();
    });
  }
);
