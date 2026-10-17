export type CharType = "whitespace" | "word" | "punctuation";

/**
 * Classifies a single character into whitespace, word (alphanumeric/underscore/unicode), or punctuation.
 */
export function getCharType(ch: string): CharType {
  if (/\s/.test(ch)) return "whitespace";
  if (/[\p{L}\p{N}_]/u.test(ch)) return "word";
  return "punctuation";
}

/**
 * Finds the index of the word boundary to the left of `offset`.
 * Standard behavior:
 * 1. Skips any whitespace immediately to the left of the offset.
 * 2. Scans backward across all contiguous characters matching the type of the first non-whitespace character encountered.
 */
export function findWordBoundaryLeft(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped === 0) return 0;

  let i = clamped - 1;

  // Step 1: Skip whitespace to the left
  while (i >= 0 && getCharType(text[i]) === "whitespace") {
    i--;
  }

  if (i < 0) return 0;

  // Step 2: Skip same character type (word or punctuation)
  const targetType = getCharType(text[i]);
  while (i >= 0 && getCharType(text[i]) === targetType) {
    i--;
  }

  return i + 1;
}

/**
 * Finds the index of the word boundary to the right of `offset`.
 * Standard behavior:
 * 1. Skips any whitespace immediately to the right of the offset.
 * 2. Scans forward across all contiguous characters matching the type of the first non-whitespace character encountered.
 */
export function findWordBoundaryRight(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped >= text.length) return text.length;

  let i = clamped;

  // Step 1: Skip whitespace to the right
  while (i < text.length && getCharType(text[i]) === "whitespace") {
    i++;
  }

  if (i >= text.length) return text.length;

  // Step 2: Skip same character type (word or punctuation)
  const targetType = getCharType(text[i]);
  while (i < text.length && getCharType(text[i]) === targetType) {
    i++;
  }

  return i;
}

/**
 * Deletes word to the left of cursor (e.g. Ctrl+Backspace, Ctrl+W, Alt+Backspace).
 */
export function deleteWordLeft(
  text: string,
  offset: number
): { text: string; offset: number } {
  const boundary = findWordBoundaryLeft(text, offset);
  return {
    text: text.slice(0, boundary) + text.slice(offset),
    offset: boundary
  };
}

/**
 * Deletes word to the right of cursor (e.g. Ctrl+Delete, Alt+D).
 */
export function deleteWordRight(
  text: string,
  offset: number
): { text: string; offset: number } {
  const boundary = findWordBoundaryRight(text, offset);
  return {
    text: text.slice(0, offset) + text.slice(boundary),
    offset
  };
}

/**
 * Deletes single character before cursor (Backspace).
 */
export function deleteBackward(
  text: string,
  offset: number
): { text: string; offset: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped === 0) return { text, offset: 0 };
  return {
    text: text.slice(0, clamped - 1) + text.slice(clamped),
    offset: clamped - 1
  };
}

/**
 * Deletes single character at cursor (Delete key).
 */
export function deleteForward(
  text: string,
  offset: number
): { text: string; offset: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped >= text.length) return { text, offset: clamped };
  return {
    text: text.slice(0, clamped) + text.slice(clamped + 1),
    offset: clamped
  };
}

/**
 * Deletes from start of line up to cursor (Ctrl+U).
 */
export function killLineLeft(
  text: string,
  offset: number
): { text: string; offset: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return {
    text: text.slice(clamped),
    offset: 0
  };
}

/**
 * Deletes from cursor to end of line (Ctrl+K).
 */
export function killLineRight(
  text: string,
  offset: number
): { text: string; offset: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return {
    text: text.slice(0, clamped),
    offset: clamped
  };
}

/**
 * Inserts a string at the cursor offset.
 */
export function insertText(
  text: string,
  offset: number,
  insert: string
): { text: string; offset: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  return {
    text: text.slice(0, clamped) + insert + text.slice(clamped),
    offset: clamped + insert.length
  };
}

export type KeyActionType =
  | "submit"
  | "select_all"
  | "home"
  | "end"
  | "word_left"
  | "word_right"
  | "char_left"
  | "char_right"
  | "delete_word_left"
  | "delete_word_right"
  | "delete_backward"
  | "delete_forward"
  | "kill_line_left"
  | "kill_line_right"
  | "insert"
  | "escape"
  | "ignore";

export interface KeyAction {
  type: KeyActionType;
  text?: string;
}

export interface KeyDescriptor {
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
  home?: boolean;
  end?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

/**
 * Resolves terminal input sequences and ink key descriptors into high-level editor actions.
 */
export function resolveKeyAction(
  input: string,
  key: KeyDescriptor = {}
): KeyAction {
  // Ignore navigation/focus keys reserved for higher-level application components
  if (
    key.upArrow ||
    key.downArrow ||
    key.tab ||
    (key.shift && key.tab) ||
    (key.ctrl && input === "c")
  ) {
    return { type: "ignore" };
  }

  // Submit on enter/return
  if (key.return || input === "\r" || input === "\n") {
    return { type: "submit" };
  }

  // Ctrl+A / SOH (\x01): Select All
  if ((key.ctrl && (input === "a" || input === "A")) || input === "\x01") {
    return { type: "select_all" };
  }

  // Home key / start of line
  if (
    key.home ||
    input === "\x1b[H" ||
    input === "\x1b[1~" ||
    input === "\x1bOH"
  ) {
    return { type: "home" };
  }

  // End key / end of line or Ctrl+E
  if (
    key.end ||
    input === "\x1b[F" ||
    input === "\x1b[4~" ||
    input === "\x1bOF" ||
    (key.ctrl && (input === "e" || input === "E")) ||
    input === "\x05"
  ) {
    return { type: "end" };
  }

  // Ctrl+Backspace, Ctrl+W, Alt+Backspace: Delete word backward
  // Terminals send: key.ctrl with backspace/0x08/0x7f, \x17 (Ctrl+W), \x1b\x7f, \x1b\x08
  if (
    (key.ctrl && key.backspace) ||
    (key.ctrl &&
      (input === "\x08" ||
        input === "\x7f" ||
        input === "w" ||
        input === "W" ||
        input === "h" ||
        input === "H")) ||
    input === "\x17" ||
    (key.meta && (key.backspace || input === "\x7f" || input === "\x08")) ||
    input === "\x1b\x7f" ||
    input === "\x1b\x08"
  ) {
    return { type: "delete_word_left" };
  }

  // Ctrl+Delete, Alt+D: Delete word forward
  // Terminals send: \x1b[3;5~ (xterm Ctrl+Delete), \x1b[3;3~ (Alt+Delete), \x1bd, \x1bD
  if (
    (key.ctrl && key.delete) ||
    input === "\x1b[3;5~" ||
    input === "\x1b[3;3~" ||
    (key.meta && (key.delete || input === "d" || input === "D")) ||
    input === "\x1bd" ||
    input === "\x1bD"
  ) {
    return { type: "delete_word_right" };
  }

  // Ctrl+Left, Alt+Left, Alt+B: Move backward by word
  // Terminals send: \x1b[1;5D (Ctrl+Left), \x1b[5D, \x1b[1;3D (Alt+Left), \x1bb
  if (
    (key.ctrl && key.leftArrow) ||
    (key.meta && key.leftArrow) ||
    input === "\x1b[1;5D" ||
    input === "\x1b[5D" ||
    input === "\x1b[1;3D" ||
    input === "\x1bb" ||
    input === "\x1bB" ||
    (key.meta && (input === "b" || input === "B"))
  ) {
    return { type: "word_left" };
  }

  // Ctrl+Right, Alt+Right, Alt+F: Move forward by word
  // Terminals send: \x1b[1;5C (Ctrl+Right), \x1b[5C, \x1b[1;3C (Alt+Right), \x1bf
  if (
    (key.ctrl && key.rightArrow) ||
    (key.meta && key.rightArrow) ||
    input === "\x1b[1;5C" ||
    input === "\x1b[5C" ||
    input === "\x1b[1;3C" ||
    input === "\x1bf" ||
    input === "\x1bF" ||
    (key.meta && (input === "f" || input === "F"))
  ) {
    return { type: "word_right" };
  }

  // Ctrl+U / \x15: Kill line left (from cursor to start)
  if ((key.ctrl && (input === "u" || input === "U")) || input === "\x15") {
    return { type: "kill_line_left" };
  }

  // Ctrl+K / \x0b: Kill line right (from cursor to end)
  if ((key.ctrl && (input === "k" || input === "K")) || input === "\x0b") {
    return { type: "kill_line_right" };
  }

  // Forward Delete (Delete key / \x1b[3~)
  if (key.delete || input === "\x1b[3~") {
    return { type: "delete_forward" };
  }

  // Backward Delete (Backspace key / \x08 / \x7f)
  if (key.backspace || input === "\x08" || input === "\x7f") {
    return { type: "delete_backward" };
  }

  // Single character Left Arrow
  if (key.leftArrow || input === "\x1b[D" || input === "\x1bOD") {
    return { type: "char_left" };
  }

  // Single character Right Arrow
  if (key.rightArrow || input === "\x1b[C" || input === "\x1bOC") {
    return { type: "char_right" };
  }

  // Escape key
  if (key.escape || input === "\x1b") {
    return { type: "escape" };
  }

  // Stray or unhandled escape sequences (drop safely so raw terminal codes don't pollute input)
  if (input.startsWith("\x1b") || input.startsWith("\u001b")) {
    return { type: "ignore" };
  }

  // Strip any remaining ANSI or ASCII control characters
  const clean = input
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

  if (clean.length > 0) {
    return { type: "insert", text: clean };
  }

  return { type: "ignore" };
}
