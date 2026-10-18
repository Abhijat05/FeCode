import { describe, it, expect } from "vitest";
import {
  getCharType,
  findWordBoundaryLeft,
  findWordBoundaryRight,
  deleteWordLeft,
  deleteWordRight,
  deleteBackward,
  deleteForward,
  killLineLeft,
  killLineRight,
  insertText,
  resolveKeyAction
} from "./textEditingUtils.js";

describe("textEditingUtils", () => {
  describe("getCharType", () => {
    it("classifies whitespace characters", () => {
      expect(getCharType(" ")).toBe("whitespace");
      expect(getCharType("\t")).toBe("whitespace");
      expect(getCharType("\n")).toBe("whitespace");
    });

    it("classifies alphanumeric, underscore, and unicode characters as word", () => {
      expect(getCharType("a")).toBe("word");
      expect(getCharType("Z")).toBe("word");
      expect(getCharType("0")).toBe("word");
      expect(getCharType("_")).toBe("word");
      expect(getCharType("é")).toBe("word");
      expect(getCharType("日")).toBe("word");
    });

    it("classifies symbols and punctuation as punctuation", () => {
      expect(getCharType("-")).toBe("punctuation");
      expect(getCharType("/")).toBe("punctuation");
      expect(getCharType(":")).toBe("punctuation");
      expect(getCharType(".")).toBe("punctuation");
      expect(getCharType("@")).toBe("punctuation");
    });
  });

  describe("findWordBoundaryLeft", () => {
    it("returns 0 for empty string or 0 offset", () => {
      expect(findWordBoundaryLeft("", 0)).toBe(0);
      expect(findWordBoundaryLeft("hello", 0)).toBe(0);
    });

    it("jumps back over a word", () => {
      expect(findWordBoundaryLeft("hello world", 11)).toBe(6);
    });

    it("jumps back over whitespace and the preceding word when offset is in whitespace", () => {
      expect(findWordBoundaryLeft("hello   world", 8)).toBe(0);
    });

    it("handles punctuation word boundaries cleanly", () => {
      // "feat/my-branch"
      // offset 14 (end of "branch") -> jump back to start of "branch" (offset 8)
      expect(findWordBoundaryLeft("feat/my-branch", 14)).toBe(8);
      // offset 8 (at "-") -> jump back over "-" (offset 7)
      expect(findWordBoundaryLeft("feat/my-branch", 8)).toBe(7);
      // offset 7 (at "my") -> jump back to "my" start (offset 5)
      expect(findWordBoundaryLeft("feat/my-branch", 7)).toBe(5);
    });
  });

  describe("findWordBoundaryRight", () => {
    it("returns length for empty string or end offset", () => {
      expect(findWordBoundaryRight("", 0)).toBe(0);
      expect(findWordBoundaryRight("hello", 5)).toBe(5);
    });

    it("jumps forward over a word", () => {
      expect(findWordBoundaryRight("hello world", 0)).toBe(5);
    });

    it("jumps forward over whitespace and the following word when offset is at whitespace", () => {
      expect(findWordBoundaryRight("hello   world", 5)).toBe(13);
    });

    it("stops at punctuation boundaries", () => {
      expect(findWordBoundaryRight("feat/my-branch", 0)).toBe(4);
      expect(findWordBoundaryRight("feat/my-branch", 4)).toBe(5);
      expect(findWordBoundaryRight("feat/my-branch", 5)).toBe(7);
    });
  });

  describe("deleteWordLeft (Ctrl+Backspace / Ctrl+W / Alt+Backspace)", () => {
    it("deletes the previous word and updates offset", () => {
      const res = deleteWordLeft("git commit -m", 13);
      expect(res.text).toBe("git commit -");
      expect(res.offset).toBe(12);

      const res2 = deleteWordLeft(res.text, res.offset);
      expect(res2.text).toBe("git commit ");
      expect(res2.offset).toBe(11);

      const res3 = deleteWordLeft(res2.text, res2.offset);
      expect(res3.text).toBe("git ");
      expect(res3.offset).toBe(4);
    });

    it("does nothing when offset is at the beginning", () => {
      const res = deleteWordLeft("hello", 0);
      expect(res.text).toBe("hello");
      expect(res.offset).toBe(0);
    });

    it("handles cursor inside word", () => {
      const res = deleteWordLeft("hello world", 9); // inside "world", after "wor"
      expect(res.text).toBe("hello ld");
      expect(res.offset).toBe(6);
    });
  });

  describe("deleteWordRight (Ctrl+Delete / Alt+D)", () => {
    it("deletes the following word preserving offset", () => {
      const res = deleteWordRight("git commit -m", 0);
      expect(res.text).toBe(" commit -m");
      expect(res.offset).toBe(0);

      const res2 = deleteWordRight(res.text, res.offset);
      expect(res2.text).toBe(" -m");
      expect(res2.offset).toBe(0);
    });

    it("does nothing when offset is at the end", () => {
      const res = deleteWordRight("hello", 5);
      expect(res.text).toBe("hello");
      expect(res.offset).toBe(5);
    });
  });

  describe("deleteBackward (Backspace)", () => {
    it("deletes single character before cursor and decrements offset", () => {
      const res = deleteBackward("abc", 3);
      expect(res.text).toBe("ab");
      expect(res.offset).toBe(2);
    });

    it("does nothing at start of line", () => {
      const res = deleteBackward("abc", 0);
      expect(res.text).toBe("abc");
      expect(res.offset).toBe(0);
    });
  });

  describe("deleteForward (Delete)", () => {
    it("deletes character under cursor without shifting offset", () => {
      const res = deleteForward("abc", 1); // cursor at 'b'
      expect(res.text).toBe("ac");
      expect(res.offset).toBe(1);
    });

    it("does nothing at end of string", () => {
      const res = deleteForward("abc", 3);
      expect(res.text).toBe("abc");
      expect(res.offset).toBe(3);
    });
  });

  describe("killLineLeft (Ctrl+U) and killLineRight (Ctrl+K)", () => {
    it("killLineLeft removes everything before cursor and resets offset to 0", () => {
      const res = killLineLeft("npm run build --prod", 13);
      expect(res.text).toBe(" --prod");
      expect(res.offset).toBe(0);
    });

    it("killLineRight removes everything after cursor and maintains offset", () => {
      const res = killLineRight("npm run build --prod", 13);
      expect(res.text).toBe("npm run build");
      expect(res.offset).toBe(13);
    });
  });

  describe("insertText", () => {
    it("inserts text at cursor and advances offset", () => {
      const res = insertText("hello world", 5, ", beautiful");
      expect(res.text).toBe("hello, beautiful world");
      expect(res.offset).toBe(16);
    });
  });

  describe("resolveKeyAction", () => {
    it("resolves Return/Enter to submit", () => {
      expect(resolveKeyAction("", { return: true }).type).toBe("submit");
      expect(resolveKeyAction("\r", {}).type).toBe("submit");
      expect(resolveKeyAction("\n", {}).type).toBe("submit");
    });

    it("resolves Ctrl+A and \\x01 to select_all", () => {
      expect(resolveKeyAction("a", { ctrl: true }).type).toBe("select_all");
      expect(resolveKeyAction("A", { ctrl: true }).type).toBe("select_all");
      expect(resolveKeyAction("\x01", {}).type).toBe("select_all");
    });

    it("resolves Home sequences", () => {
      expect(resolveKeyAction("", { home: true }).type).toBe("home");
      expect(resolveKeyAction("\x1b[H", {}).type).toBe("home");
      expect(resolveKeyAction("\x1b[1~", {}).type).toBe("home");
      expect(resolveKeyAction("\x1bOH", {}).type).toBe("home");
    });

    it("resolves End sequences and Ctrl+E", () => {
      expect(resolveKeyAction("", { end: true }).type).toBe("end");
      expect(resolveKeyAction("\x1b[F", {}).type).toBe("end");
      expect(resolveKeyAction("\x1b[4~", {}).type).toBe("end");
      expect(resolveKeyAction("\x1bOF", {}).type).toBe("end");
      expect(resolveKeyAction("e", { ctrl: true }).type).toBe("end");
      expect(resolveKeyAction("\x05", {}).type).toBe("end");
    });

    it("resolves Ctrl+Backspace, Ctrl+W, and Alt+Backspace variations", () => {
      expect(resolveKeyAction("", { ctrl: true, backspace: true }).type).toBe("delete_word_left");
      expect(resolveKeyAction("\x08", { ctrl: true }).type).toBe("delete_word_left");
      expect(resolveKeyAction("\x7f", { ctrl: true }).type).toBe("delete_word_left");
      expect(resolveKeyAction("w", { ctrl: true }).type).toBe("delete_word_left");
      expect(resolveKeyAction("\x17", {}).type).toBe("delete_word_left");
      expect(resolveKeyAction("", { meta: true, backspace: true }).type).toBe("delete_word_left");
      expect(resolveKeyAction("\x1b\x7f", {}).type).toBe("delete_word_left");
      expect(resolveKeyAction("\x1b\x08", {}).type).toBe("delete_word_left");
    });

    it("resolves Ctrl+Delete, Alt+D, and Alt+Delete variations", () => {
      expect(resolveKeyAction("", { ctrl: true, delete: true }).type).toBe("delete_word_right");
      expect(resolveKeyAction("\x1b[3;5~", {}).type).toBe("delete_word_right");
      expect(resolveKeyAction("\x1b[3;3~", {}).type).toBe("delete_word_right");
      expect(resolveKeyAction("d", { meta: true }).type).toBe("delete_word_right");
      expect(resolveKeyAction("\x1bd", {}).type).toBe("delete_word_right");
    });

    it("resolves word navigation left and right", () => {
      expect(resolveKeyAction("", { ctrl: true, leftArrow: true }).type).toBe("word_left");
      expect(resolveKeyAction("\x1b[1;5D", {}).type).toBe("word_left");
      expect(resolveKeyAction("\x1bb", {}).type).toBe("word_left");

      expect(resolveKeyAction("", { ctrl: true, rightArrow: true }).type).toBe("word_right");
      expect(resolveKeyAction("\x1b[1;5C", {}).type).toBe("word_right");
      expect(resolveKeyAction("\x1bf", {}).type).toBe("word_right");
    });

    it("resolves line kill shortcuts (Ctrl+U and Ctrl+K)", () => {
      expect(resolveKeyAction("u", { ctrl: true }).type).toBe("kill_line_left");
      expect(resolveKeyAction("\x15", {}).type).toBe("kill_line_left");
      expect(resolveKeyAction("k", { ctrl: true }).type).toBe("kill_line_right");
      expect(resolveKeyAction("\x0b", {}).type).toBe("kill_line_right");
    });

    it("resolves basic Delete and Backspace", () => {
      // Ink emits key.delete for \x7f (Backspace on modern terminals) without escape sequences
      expect(resolveKeyAction("", { delete: true }).type).toBe("delete_backward");
      expect(resolveKeyAction("\x1b[3~", {}).type).toBe("delete_forward");
      expect(resolveKeyAction("\x1b[3~", { delete: true }).type).toBe("delete_forward");
      expect(resolveKeyAction("", { delete: true, code: "[3~" }).type).toBe("delete_forward");
      expect(resolveKeyAction("", { backspace: true }).type).toBe("delete_backward");
      expect(resolveKeyAction("\x7f", {}).type).toBe("delete_backward");
      expect(resolveKeyAction("\x08", {}).type).toBe("delete_backward");
      expect(resolveKeyAction("\b", {}).type).toBe("delete_backward");
    });

    it("resolves plain Left and Right arrows", () => {
      expect(resolveKeyAction("", { leftArrow: true }).type).toBe("char_left");
      expect(resolveKeyAction("\x1b[D", {}).type).toBe("char_left");
      expect(resolveKeyAction("", { rightArrow: true }).type).toBe("char_right");
      expect(resolveKeyAction("\x1b[C", {}).type).toBe("char_right");
    });

    it("ignores Ctrl+C, tab, up, down", () => {
      expect(resolveKeyAction("c", { ctrl: true }).type).toBe("ignore");
      expect(resolveKeyAction("", { tab: true }).type).toBe("ignore");
      expect(resolveKeyAction("", { upArrow: true }).type).toBe("ignore");
      expect(resolveKeyAction("", { downArrow: true }).type).toBe("ignore");
    });

    it("preserves bracketed paste escape sequences for pasteUtils to process", () => {
      expect(resolveKeyAction("\x1b[200~hello\nworld\x1b[201~", {}).type).toBe("insert");
      expect(resolveKeyAction("\x1b[200~", {}).type).toBe("insert");
    });

    it("safely ignores unknown ANSI escape sequences to prevent garbage text insertion", () => {
      expect(resolveKeyAction("\x1b[1;2A", {}).type).toBe("ignore");
      expect(resolveKeyAction("\x1b[999~", {}).type).toBe("ignore");
    });

    it("resolves printable text and pasted strings to insert", () => {
      expect(resolveKeyAction("hello", {})).toEqual({
        type: "insert",
        text: "hello"
      });
      expect(resolveKeyAction("x", {})).toEqual({
        type: "insert",
        text: "x"
      });
    });
  });
});
