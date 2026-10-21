import { describe, it, expect } from "vitest";
import { symbols } from "./symbols.js";

describe("Terminal symbols design system (symbols.ts)", () => {
  it("provides standard Unicode geometric glyphs without emojis", () => {
    expect(symbols.prompt).toBe("❯");
    expect(symbols.tick).toBe("✔");
    expect(symbols.cross).toBe("✖");
    expect(symbols.dot).toBe("●");
    expect(symbols.circle).toBe("○");
    expect(symbols.play).toBe("▶");
    expect(symbols.verifying).toBe("◎");
    expect(symbols.rail).toBe("│");
    expect(symbols.rule).toBe("─");
    expect(symbols.arrow).toBe("→");
    expect(symbols.warning).toBe("⚠");
    expect(symbols.cancelled).toBe("⊘");
    expect(symbols.bullet).toBe("•");
    expect(symbols.ellipsis).toBe("…");
  });

  it("contains zero graphic color emojis", () => {
    // Graphic color emojis reside in SMP (Plane 1): U+1F000 - U+1FFFF
    const graphicEmojiRegex = /[\u{1F000}-\u{1FAFF}]/u;
    for (const [, value] of Object.entries(symbols)) {
      expect(graphicEmojiRegex.test(value)).toBe(false);
    }
  });

  it("is immutable and typed", () => {
    expect(Object.isFrozen(symbols)).toBe(true);
  });
});
