import { describe, it, expect } from "vitest";
import { sanitizeApiKey, sanitizeBaseUrl } from "./sanitization.js";

describe("sanitizeApiKey", () => {
  it("returns empty string for null, undefined, or empty values", () => {
    expect(sanitizeApiKey()).toBe("");
    expect(sanitizeApiKey(null)).toBe("");
    expect(sanitizeApiKey("")).toBe("");
    expect(sanitizeApiKey("    ")).toBe("");
  });

  it("leaves clean API keys intact", () => {
    expect(sanitizeApiKey("AIzaSyD-1234567890abcdef_XYZ")).toBe("AIzaSyD-1234567890abcdef_XYZ");
    expect(sanitizeApiKey("sk-ant-api03-1234567890")).toBe("sk-ant-api03-1234567890");
    expect(sanitizeApiKey("nvapi-1234567890")).toBe("nvapi-1234567890");
  });

  it("strips carriage returns and newlines from keys", () => {
    expect(sanitizeApiKey("AIzaSyD-1234567890abcdef\r\n")).toBe("AIzaSyD-1234567890abcdef");
    expect(sanitizeApiKey("\r\nAIzaSyD-1234567890abcdef\n")).toBe("AIzaSyD-1234567890abcdef");
    expect(sanitizeApiKey("AIzaSy\r\nD-12345\nabcdef")).toBe("AIzaSyD-12345abcdef");
  });

  it("strips double and single quotes surrounding the key", () => {
    expect(sanitizeApiKey('"AIzaSyD-1234567890abcdef"')).toBe("AIzaSyD-1234567890abcdef");
    expect(sanitizeApiKey("'AIzaSyD-1234567890abcdef'")).toBe("AIzaSyD-1234567890abcdef");
    expect(sanitizeApiKey('`AIzaSyD-1234567890abcdef`')).toBe("AIzaSyD-1234567890abcdef");
  });

  it("strips smart curly quotes copied from rich text/web docs", () => {
    expect(sanitizeApiKey('“AIzaSyD-1234567890abcdef”')).toBe("AIzaSyD-1234567890abcdef");
    expect(sanitizeApiKey('‘AIzaSyD-1234567890abcdef’')).toBe("AIzaSyD-1234567890abcdef");
  });

  it("strips environment variable assignment prefixes when copied from .env or bash", () => {
    expect(sanitizeApiKey('export GEMINI_API_KEY="AIzaSyD-1234567890abcdef"')).toBe(
      "AIzaSyD-1234567890abcdef"
    );
    expect(sanitizeApiKey('GEMINI_API_KEY = "AIzaSyD-1234567890abcdef"')).toBe(
      "AIzaSyD-1234567890abcdef"
    );
    expect(sanitizeApiKey("OPENAI_API_KEY=sk-1234567890")).toBe("sk-1234567890");
    expect(sanitizeApiKey('apiKey: "AIzaSyD-1234567890abcdef"')).toBe(
      "AIzaSyD-1234567890abcdef"
    );
  });

  it("strips bracketed-paste terminal markers and ANSI escape sequences", () => {
    expect(sanitizeApiKey("\x1b[200~AIzaSyD-1234567890abcdef\x1b[201~")).toBe(
      "AIzaSyD-1234567890abcdef"
    );
    expect(sanitizeApiKey("[200~AIzaSyD-1234567890abcdef[201~")).toBe(
      "AIzaSyD-1234567890abcdef"
    );
  });

  it("strips non-printable ASCII control characters", () => {
    // Byte 1 (\x01), byte 27 (\x1b ESC), byte 8 (\x08 BS), byte 127 (\x7f DEL)
    const tainted = "\x01\x1bAIzaSyD-12345\x08abcdef\x7f";
    expect(sanitizeApiKey(tainted)).toBe("AIzaSyD-12345abcdef");
  });

  it("strips zero-width characters and BOM", () => {
    const withBom = "\uFEFFAIzaSyD-1234567890abcdef\u200B\u200C\u200D";
    expect(sanitizeApiKey(withBom)).toBe("AIzaSyD-1234567890abcdef");
  });

  it("handles combinations of quotes, newlines, and spaces", () => {
    expect(sanitizeApiKey('  \r\n  "AIzaSyD-1234567890abcdef"  \n  ')).toBe(
      "AIzaSyD-1234567890abcdef"
    );
  });
});

describe("sanitizeBaseUrl", () => {
  it("returns undefined for empty input", () => {
    expect(sanitizeBaseUrl()).toBeUndefined();
    expect(sanitizeBaseUrl(null)).toBeUndefined();
    expect(sanitizeBaseUrl("")).toBeUndefined();
    expect(sanitizeBaseUrl("   ")).toBeUndefined();
  });

  it("trims and strips trailing slashes", () => {
    expect(sanitizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(sanitizeBaseUrl("https://api.openai.com/v1///")).toBe("https://api.openai.com/v1");
  });

  it("strips quotes and env prefixes", () => {
    expect(sanitizeBaseUrl('"http://localhost:11434/v1"')).toBe("http://localhost:11434/v1");
    expect(sanitizeBaseUrl("export BASE_URL='http://localhost:11434/v1'")).toBe(
      "http://localhost:11434/v1"
    );
  });
});
