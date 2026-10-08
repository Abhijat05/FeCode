import { describe, it, expect } from "vitest";
import {
  stripHostileAnsi,
  normalizeCarriageReturns,
  sanitizeBinaryAndControlChars,
  sliceUnicodeSafe,
  sanitizeCommandOutput
} from "./outputSanitizer.js";

describe("outputSanitizer", () => {
  describe("stripHostileAnsi", () => {
    it("strips OSC 52 clipboard hijacking sequences", () => {
      const hostileBel = "Starting...\x1b]52;c;dGVzdA==\x07Finished.";
      expect(stripHostileAnsi(hostileBel)).toBe("Starting...Finished.");

      const hostileSt = "Starting...\x1b]52;c;dGVzdA==\x1b\\Finished.";
      expect(stripHostileAnsi(hostileSt)).toBe("Starting...Finished.");
    });

    it("strips OSC window title and hyperlink sequences", () => {
      const title = "\x1b]0;Spoofed Admin Console\x07Hello world";
      expect(stripHostileAnsi(title)).toBe("Hello world");

      const link = "\x1b]8;;https://malicious.site\x07Click here\x1b]8;;\x07";
      expect(stripHostileAnsi(link)).toBe("Click here");
    });

    it("strips CSI screen clear, line clear, and alternate buffer switches", () => {
      const clearScreen = "\x1b[2J\x1b[HWelcome";
      expect(stripHostileAnsi(clearScreen)).toBe("Welcome");

      const scrollbackClear = "\x1b[3JErasing scrollback";
      expect(stripHostileAnsi(scrollbackClear)).toBe("Erasing scrollback");

      const altBuffer = "\x1b[?1049hIn Alt Buffer\x1b[?1049lExited";
      expect(stripHostileAnsi(altBuffer)).toBe("In Alt BufferExited");

      const lineClear = "Line content\x1b[2KCleared";
      expect(stripHostileAnsi(lineClear)).toBe("Line contentCleared");
    });

    it("strips cursor movement and private mode sequences", () => {
      const cursor = "\x1b[2A\x1b[10C\x1b[?25lText\x1b[?25h";
      expect(stripHostileAnsi(cursor)).toBe("Text");
    });

    it("preserves safe SGR colors and formatting codes", () => {
      const colored = "\x1b[1m\x1b[31mFAIL:\x1b[0m \x1b[32m1 test passed\x1b[0m";
      expect(stripHostileAnsi(colored)).toBe(colored);

      const trueColor = "\x1b[38;2;255;128;0mOrange Text\x1b[0m";
      expect(stripHostileAnsi(trueColor)).toBe(trueColor);
    });

    it("strips hostile escape sequences while retaining valid SGR tags in mixed text", () => {
      const mixed =
        "\x1b[31mError\x1b[0m: \x1b[2J\x1b[H\x1b]52;c;payload\x07\x1b[32mSuccess\x1b[0m";
      expect(stripHostileAnsi(mixed)).toBe("\x1b[31mError\x1b[0m: \x1b[32mSuccess\x1b[0m");
    });
  });

  describe("normalizeCarriageReturns", () => {
    it("converts lone carriage returns to newlines to prevent deceptive line overwriting", () => {
      const deceptive = "FAIL: 10 tests failed\rPASS: All tests passed!\n";
      expect(normalizeCarriageReturns(deceptive)).toBe(
        "FAIL: 10 tests failed\nPASS: All tests passed!\n"
      );
    });

    it("preserves standard Windows CRLF line endings", () => {
      const windows = "Line 1\r\nLine 2\r\nLine 3\r\n";
      expect(normalizeCarriageReturns(windows)).toBe("Line 1\r\nLine 2\r\nLine 3\r\n");
    });
  });

  describe("sanitizeBinaryAndControlChars", () => {
    it("removes null bytes and bell characters", () => {
      const raw = "Hello\x00World\x07Alert!";
      expect(sanitizeBinaryAndControlChars(raw)).toBe("HelloWorldAlert!");
    });

    it("preserves normal whitespace (tab, newline, crlf)", () => {
      const normal = "Col1\tCol2\r\nRow2\tVal\n";
      expect(sanitizeBinaryAndControlChars(normal)).toBe("Col1\tCol2\r\nRow2\tVal\n");
    });

    it("strips harmful C0 device control and formatting characters", () => {
      const raw = "Text\x08\x0b\x0c\x0e\x0f\x1aEnd";
      expect(sanitizeBinaryAndControlChars(raw)).toBe("TextEnd");
    });
  });

  describe("sliceUnicodeSafe", () => {
    it("does not truncate when within byte budget", () => {
      const text = "Hello world!";
      const res = sliceUnicodeSafe(text, 100);
      expect(res.truncated).toBe(false);
      expect(res.text).toBe(text);
    });

    it("slices at valid code point boundaries without severing surrogate pairs", () => {
      // 🚀 is '\uD83D\uDE80' (4 UTF-8 bytes, 2 UTF-16 code units)
      const text = "Hello 🚀 World";
      // Byte lengths: "Hello " = 6 bytes, "🚀" = 4 bytes (total 10 bytes), " World" = 6 bytes
      const res = sliceUnicodeSafe(text, 8); // 8 bytes allows "Hello ", cannot fit 🚀 (needs 10)
      expect(res.truncated).toBe(true);
      expect(res.text).toBe("Hello ");
      expect(Buffer.byteLength(res.text, "utf-8")).toBeLessThanOrEqual(8);

      const resWithRocket = sliceUnicodeSafe(text, 10); // fits "Hello 🚀"
      expect(resWithRocket.truncated).toBe(true);
      expect(resWithRocket.text).toBe("Hello 🚀");

      // Verify JSON serialization doesn't throw or leave invalid surrogates
      expect(() => JSON.stringify(res.text)).not.toThrow();
      expect(() => JSON.stringify(resWithRocket.text)).not.toThrow();
    });

    it("handles multi-byte international characters cleanly", () => {
      // Japanese: 'こんにちは' (3 bytes each = 15 bytes)
      const text = "こんにちは";
      const res = sliceUnicodeSafe(text, 7); // fits 2 chars (6 bytes)
      expect(res.truncated).toBe(true);
      expect(res.text).toBe("こん");
      expect(Buffer.byteLength(res.text, "utf-8")).toBeLessThanOrEqual(7);
    });
  });

  describe("sanitizeCommandOutput", () => {
    it("runs complete sanitization pipeline: ANSI filter, CR normalization, and safe slicing", () => {
      const raw =
        "FAIL: 5 tests failed\r\x1b[32mPASS: All passed\x1b[0m\x1b]52;c;steal\x07\x1b[2J\x00\x07";
      const result = sanitizeCommandOutput(raw);
      expect(result.text).toContain("FAIL: 5 tests failed\n");
      expect(result.text).toContain("\x1b[32mPASS: All passed\x1b[0m");
      expect(result.text).not.toContain("steal");
      expect(result.text).not.toContain("\x1b[2J");
      expect(result.text).not.toContain("\x00");
      expect(result.text).not.toContain("\x07");
    });

    it("applies maxOutputBytes with truncation marker when specified", () => {
      const longOutput = "Line " + "X".repeat(500);
      const result = sanitizeCommandOutput(longOutput, { maxOutputBytes: 100 });
      expect(result.truncated).toBe(true);
      expect(result.text).toContain("... [output truncated due to size limit]");
      expect(Buffer.byteLength(result.text.split("\n... [output truncated")[0], "utf-8")).toBeLessThanOrEqual(100);
    });
  });
});
