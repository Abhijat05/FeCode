import { describe, it, expect } from "vitest";
import { loadConfig } from "@fecode/shared";
import { GeminiModelProvider } from "./index.js";
import type { ModelEvent } from "../../types.js";

const config = loadConfig();
const apiKey = config.geminiApiKey;
const isLiveTestEnabled = Boolean(apiKey && apiKey.startsWith("AIzaSy"));

describe.runIf(isLiveTestEnabled)(
  "GeminiModelProvider Real API Integration Tests",
  () => {
    const model = config.model || "gemini-2.5-flash";

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

    it("2. Tool calling (write_file and execute_command tool invocation)", async () => {
      const provider = new GeminiModelProvider({ apiKey, model });

      const tools = [
        {
          name: "write_file",
          description: "Create or overwrite a file with specified content.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
              content: { type: "string", description: "Text content to write" }
            },
            required: ["path", "content"]
          }
        },
        {
          name: "execute_command",
          description: "Run a controlled shell command.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command line string" }
            },
            required: ["command"]
          }
        }
      ];

      const events: ModelEvent[] = [];
      for await (const event of provider.generate({
        messages: [
          {
            role: "user",
            content: "Run npm run typecheck to check for TypeScript errors."
          }
        ],
        tools
      })) {
        events.push(event);
      }

      const toolCallEvent = events.find((e) => e.type === "tool_call");
      expect(toolCallEvent).toBeDefined();
      if (toolCallEvent && toolCallEvent.type === "tool_call") {
        expect(toolCallEvent.call.name).toBe("execute_command");
        expect((toolCallEvent.call.arguments as { command: string }).command).toContain("npm");
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
