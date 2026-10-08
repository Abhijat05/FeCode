/**
 * Sanitizes command output and terminal streams to prevent terminal corruption,
 * host clipboard hijacking (OSC 52), deceptive UI spoofing, and invalid Unicode serialization.
 */

/* eslint-disable no-control-regex */

// OSC (Operating System Command) sequences: \x1b] ... (\x07 or \x1b\ or end of string)
// Matches clipboard writes (OSC 52), window titles (OSC 0/1/2), hyperlinks (OSC 8), desktop notifications.
const OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g;

// CSI (Control Sequence Introducer) non-SGR sequences.
// SGR sequences end in 'm' (styling/colors). All other CSI sequences (clearing screen J/K,
// cursor movement A-H, alternate screen buffers ?1049h, private modes) end in [@-ln-~] (excluding 'm').
const CSI_NON_SGR_REGEX = /\x1b\[[\d;?]*([@-ln-~])/g;

// Other two-character or mode terminal escape codes (e.g., ESC c reset, ESC 7/8 cursor save/restore)
const MISC_ESC_REGEX = /\x1b[=><#%()][0-9A-Za-z]?|\x1b[78cDEMHNOPVWXZ]/g;

// Stray ESC characters that are not part of a valid SGR sequence
const STRAY_ESC_REGEX = /\x1b(?!\[[0-9;]*m)/g;

// C0 control characters and null bytes (excluding tab \t, newline \n, and carriage return \r)
const HARMFUL_CONTROL_CHARS_REGEX = /[\x00\x07\x08\x0b\x0c\x0e\x0f\x1a]/g;

/**
 * Strips hostile ANSI escape sequences (screen clears, cursor movements, OSC 52 clipboard commands)
 * while preserving safe SGR color and text formatting tags (\x1b[...m).
 */
export function stripHostileAnsi(text: string): string {
  if (!text) return "";
  return text
    .replace(OSC_REGEX, "")
    .replace(CSI_NON_SGR_REGEX, "")
    .replace(MISC_ESC_REGEX, "")
    .replace(STRAY_ESC_REGEX, "");
}

/**
 * Normalizes carriage returns. Converts lone '\r' (not immediately followed by '\n')
 * to newlines to prevent terminal overwriting deception, while preserving standard Windows CRLF ('\r\n').
 */
export function normalizeCarriageReturns(text: string): string {
  if (!text) return "";
  return text.replace(/\r(?!\n)/g, "\n");
}

/**
 * Strips null bytes, audible bells, backspace floods, and device control characters.
 */
export function sanitizeBinaryAndControlChars(text: string): string {
  if (!text) return "";
  return text.replace(HARMFUL_CONTROL_CHARS_REGEX, "");
}

/**
 * Safely truncates a UTF-8 string to a maximum byte budget without severing
 * multi-byte code points or UTF-16 surrogate pairs (e.g. emojis, non-BMP characters).
 * Guarantees valid UTF-8 and valid JSON serialization.
 */
export function sliceUnicodeSafe(
  str: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  if (!str) return { text: "", truncated: false };

  const totalBytes = Buffer.byteLength(str, "utf-8");
  if (totalBytes <= maxBytes) {
    return { text: str, truncated: false };
  }

  let byteCount = 0;
  let cutIndex = 0;

  for (const codePoint of str) {
    const cpBytes = Buffer.byteLength(codePoint, "utf-8");
    if (byteCount + cpBytes > maxBytes) {
      return {
        text: str.slice(0, cutIndex),
        truncated: true
      };
    }
    byteCount += cpBytes;
    cutIndex += codePoint.length;
  }

  return { text: str.slice(0, cutIndex), truncated: true };
}

export interface SanitizeCommandOutputOptions {
  maxOutputBytes?: number;
}

export interface SanitizeCommandOutputResult {
  text: string;
  truncated: boolean;
}

/**
 * Complete sanitization pipeline for command outputs:
 * 1. Normalizes carriage returns to prevent line-overwriting deception.
 * 2. Strips hostile ANSI/OSC escapes (preserving safe SGR colors).
 * 3. Strips null bytes and hostile control characters.
 * 4. Safely clamps to byte budget along Unicode code point boundaries.
 */
export function sanitizeCommandOutput(
  raw: string,
  options?: SanitizeCommandOutputOptions
): SanitizeCommandOutputResult {
  if (!raw) return { text: "", truncated: false };

  let cleaned = normalizeCarriageReturns(raw);
  cleaned = stripHostileAnsi(cleaned);
  cleaned = sanitizeBinaryAndControlChars(cleaned);

  if (typeof options?.maxOutputBytes === "number" && options.maxOutputBytes > 0) {
    const sliced = sliceUnicodeSafe(cleaned, options.maxOutputBytes);
    if (sliced.truncated) {
      return {
        text: sliced.text + "\n... [output truncated due to size limit]",
        truncated: true
      };
    }
    return { text: sliced.text, truncated: false };
  }

  return { text: cleaned, truncated: false };
}
