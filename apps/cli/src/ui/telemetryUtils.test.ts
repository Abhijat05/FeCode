import { describe, it, expect } from "vitest";
import {
  getModelContextLimit,
  formatTokenCount,
  formatTokenTelemetry,
  estimateMessagesTokens
} from "./telemetryUtils.js";

describe("telemetryUtils", () => {
  describe("getModelContextLimit", () => {
    it("returns 1M for Gemini models or provider", () => {
      expect(getModelContextLimit("gemini-2.5-flash", "gemini")).toBe(1_000_000);
      expect(getModelContextLimit("gemini-1.5-pro")).toBe(1_000_000);
      expect(getModelContextLimit(undefined, "gemini")).toBe(1_000_000);
    });

    it("returns 128k for OpenAI GPT-4o models", () => {
      expect(getModelContextLimit("gpt-4o", "openai")).toBe(128_000);
    });

    it("returns 200k for Claude models", () => {
      expect(getModelContextLimit("claude-3-5-sonnet", "anthropic")).toBe(200_000);
    });

    it("returns 128k for DeepSeek, Qwen, or Mistral models", () => {
      expect(getModelContextLimit("deepseek-ai/deepseek-v3")).toBe(128_000);
      expect(getModelContextLimit("qwen2.5-coder")).toBe(128_000);
      expect(getModelContextLimit("mistralai/mistral-large")).toBe(128_000);
    });

    it("defaults to 128k for unknown models", () => {
      expect(getModelContextLimit(undefined, undefined)).toBe(128_000);
    });
  });

  describe("formatTokenCount", () => {
    it("formats small numbers as plain strings", () => {
      expect(formatTokenCount(0)).toBe("0");
      expect(formatTokenCount(450)).toBe("450");
    });

    it("formats thousands with k suffix", () => {
      expect(formatTokenCount(1200)).toBe("1.2k");
      expect(formatTokenCount(14200)).toBe("14.2k");
      expect(formatTokenCount(128000)).toBe("128k");
    });

    it("formats millions with M suffix", () => {
      expect(formatTokenCount(1000000)).toBe("1.0M");
      expect(formatTokenCount(2500000)).toBe("2.5M");
    });
  });

  describe("formatTokenTelemetry", () => {
    it("formats wide layout with tokens, limit, and percentage", () => {
      const res = formatTokenTelemetry(14200, 128000, "wide");
      expect(res.text).toBe("14.2k/128k tokens (11%)");
      expect(res.percent).toBe(11);
      expect(res.color).toBe("cyan");
    });

    it("formats medium layout compactly", () => {
      const res = formatTokenTelemetry(14200, 128000, "medium");
      expect(res.text).toBe("14.2k/128k (11%)");
      expect(res.color).toBe("cyan");
    });

    it("formats narrow layout with current tokens only", () => {
      const res = formatTokenTelemetry(14200, 128000, "narrow");
      expect(res.text).toBe("14.2k tokens");
    });

    it("returns empty string for very_narrow layout", () => {
      const res = formatTokenTelemetry(14200, 128000, "very_narrow");
      expect(res.text).toBe("");
    });

    it("colors warning yellow at >= 65% and red at >= 85%", () => {
      const yellow = formatTokenTelemetry(70000, 100000, "wide");
      expect(yellow.color).toBe("yellow");

      const red = formatTokenTelemetry(90000, 100000, "wide");
      expect(red.color).toBe("red");
    });

    it("colors gray when 0 tokens", () => {
      const gray = formatTokenTelemetry(0, 128000, "wide");
      expect(gray.color).toBe("gray");
    });
  });

  describe("estimateMessagesTokens", () => {
    it("returns 0 for empty or undefined messages", () => {
      expect(estimateMessagesTokens(undefined)).toBe(0);
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it("estimates tokens across message contents and toolCalls arguments", () => {
      const messages = [
        { role: "user", content: "12345678" }, // 8 chars = 2 tokens
        {
          role: "assistant",
          content: "1234", // 4 chars = 1 token
          toolCalls: [
            { arguments: { path: "src/App.tsx" } } // ~22 chars = 6 tokens
          ]
        },
        { role: "tool", content: "123456789012" } // 12 chars = 3 tokens
      ];
      const total = estimateMessagesTokens(messages);
      expect(total).toBeGreaterThan(10);
    });
  });
});
