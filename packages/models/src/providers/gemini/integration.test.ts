import { describe, it, expect } from "vitest";
import { GeminiModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

const apiKey = process.env.GEMINI_API_KEY;

describe.runIf(Boolean(apiKey))(
  "GeminiModelProvider Real API Integration Test",
  () => {
    it("connects to real Gemini API and streams response", async () => {
      const provider = new GeminiModelProvider({
        apiKey,
        model: process.env.FE_MODEL || "gemini-2.5-flash"
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
