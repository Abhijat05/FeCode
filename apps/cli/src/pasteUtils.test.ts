import { describe, it, expect } from "vitest";
import {
  getPasteLines,
  formatPasteToken,
  processPastedInput,
  expandPastedTokens
} from "./pasteUtils.js";

describe("pasteUtils", () => {
  describe("getPasteLines", () => {
    it("splits standard LF newlines", () => {
      expect(getPasteLines("line1\nline2\nline3")).toEqual(["line1", "line2", "line3"]);
    });

    it("splits CRLF newlines", () => {
      expect(getPasteLines("line1\r\nline2\r\nline3")).toEqual(["line1", "line2", "line3"]);
    });

    it("strips single trailing newline", () => {
      expect(getPasteLines("line1\nline2\n")).toEqual(["line1", "line2"]);
    });

    it("preserves internal blank lines", () => {
      expect(getPasteLines("line1\n\nline2")).toEqual(["line1", "", "line2"]);
    });

    it("returns single element for single line", () => {
      expect(getPasteLines("hello world")).toEqual(["hello world"]);
      expect(getPasteLines("hello world\n")).toEqual(["hello world"]);
    });
  });

  describe("formatPasteToken", () => {
    it("formats singular line extra", () => {
      expect(formatPasteToken(1, 2)).toBe("[Pasted text #1 +1 line]");
    });

    it("formats plural lines extra", () => {
      expect(formatPasteToken(1, 23)).toBe("[Pasted text #1 +22 lines]");
      expect(formatPasteToken(2, 5)).toBe("[Pasted text #2 +4 lines]");
    });
  });

  describe("processPastedInput", () => {
    it("collapses multi-line bracketed paste into token", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };
      const raw = "\x1b[200~line1\nline2\nline3\x1b[201~";

      const result = processPastedInput(raw, "", registry, counterRef);

      expect(result).toBe("[Pasted text #1 +2 lines]");
      expect(counterRef.current).toBe(1);
      expect(registry.get("[Pasted text #1 +2 lines]")).toBe("line1\nline2\nline3");
    });

    it("keeps single-line bracketed paste inline without collapsing", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };
      const raw = "\x1b[200~single line paste\x1b[201~";

      const result = processPastedInput(raw, "", registry, counterRef);

      expect(result).toBe("single line paste");
      expect(counterRef.current).toBe(0);
      expect(registry.size).toBe(0);
    });

    it("collapses unbracketed multi-line paste", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };
      const raw = "line1\nline2\nline3";

      const result = processPastedInput(raw, "", registry, counterRef);

      expect(result).toBe("[Pasted text #1 +2 lines]");
      expect(counterRef.current).toBe(1);
      expect(registry.get("[Pasted text #1 +2 lines]")).toBe("line1\nline2\nline3");
    });

    it("collapses multi-line paste appended to existing query prefix", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };
      const prevQuery = "Please review: ";
      const raw = "Please review: \x1b[200~function test() {\n  return 42;\n}\x1b[201~";

      const result = processPastedInput(raw, prevQuery, registry, counterRef);

      expect(result).toBe("Please review: [Pasted text #1 +2 lines]");
      expect(registry.get("[Pasted text #1 +2 lines]")).toBe("function test() {\n  return 42;\n}");
    });

    it("handles multiple separate pastes sequentially", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };

      const r1 = processPastedInput("\x1b[200~first\nsecond\x1b[201~", "", registry, counterRef);
      expect(r1).toBe("[Pasted text #1 +1 line]");

      const r2 = processPastedInput(
        `Compare ${r1} with \x1b[200~a\nb\nc\x1b[201~`,
        `Compare ${r1} with `,
        registry,
        counterRef
      );
      expect(r2).toBe("Compare [Pasted text #1 +1 line] with [Pasted text #2 +2 lines]");
      expect(counterRef.current).toBe(2);
    });

    it("cleans mouse escapes and residual ANSI", () => {
      const registry = new Map<string, string>();
      const counterRef = { current: 0 };
      const raw = "\x1b[<0;20;10Mnormal text";

      const result = processPastedInput(raw, "", registry, counterRef);

      expect(result).toBe("normal text");
    });
  });

  describe("expandPastedTokens", () => {
    it("expands single token to its stored multi-line content", () => {
      const registry = new Map<string, string>();
      registry.set("[Pasted text #1 +2 lines]", "line1\nline2\nline3");

      const expanded = expandPastedTokens("Review this: [Pasted text #1 +2 lines]", registry);

      expect(expanded).toBe("Review this: line1\nline2\nline3");
    });

    it("expands multiple tokens within the same prompt", () => {
      const registry = new Map<string, string>();
      registry.set("[Pasted text #1 +1 line]", "a\nb");
      registry.set("[Pasted text #2 +2 lines]", "x\ny\nz");

      const expanded = expandPastedTokens(
        "Diff [Pasted text #1 +1 line] against [Pasted text #2 +2 lines]",
        registry
      );

      expect(expanded).toBe("Diff a\nb against x\ny\nz");
    });

    it("returns unmodified string when no tokens exist or registry empty", () => {
      const registry = new Map<string, string>();

      expect(expandPastedTokens("Hello world", registry)).toBe("Hello world");
      expect(expandPastedTokens("[Pasted text #99 +5 lines]", registry)).toBe(
        "[Pasted text #99 +5 lines]"
      );
    });
  });
});
