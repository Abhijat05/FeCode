/**
 * Splits pasted text into normalized lines, accounting for CRLF and trailing newlines.
 */
export function getPasteLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Formats a collapsed paste token label.
 * E.g., 23 lines -> "[Pasted text #1 +22 lines]"
 * E.g., 2 lines  -> "[Pasted text #1 +1 line]"
 */
export function formatPasteToken(id: number, lineCount: number): string {
  const extraLines = Math.max(0, lineCount - 1);
  const lineWord = extraLines === 1 ? "line" : "lines";
  return `[Pasted text #${id} +${extraLines} ${lineWord}]`;
}

/**
 * Processes incoming input from the terminal or text input handler.
 * Detects bracketed paste delimiters or unbracketed multi-line text:
 * - If 2+ lines: records full raw text in registry, returns compact token string.
 * - If 1 line: returns original text without tokenization.
 * Also sanitizes mouse escapes and residual ANSI.
 */
export function processPastedInput(
  rawVal: string,
  prevQuery: string,
  registry: Map<string, string>,
  counterRef: { current: number }
): string {
  let val = rawVal;

  /* eslint-disable no-control-regex */
  // 1. Handle bracketed paste blocks first: \x1b[200~...content...\x1b[201~
  if (val.includes("[200~") && val.includes("[201~")) {
    val = val.replace(/(?:\x1b)?\[200~([\s\S]*?)(?:\x1b)?\[201~/g, (_match, content: string) => {
      const lines = getPasteLines(content);
      if (lines.length >= 2) {
        counterRef.current += 1;
        const token = formatPasteToken(counterRef.current, lines.length);
        registry.set(token, content);
        return token;
      }
      return content.replace(/\r?\n/g, " ");
    });
  }

  // 2. Sanitize any orphaned bracketed paste or mouse escape sequences
  if (
    val.includes("[200~") ||
    val.includes("[201~") ||
    val.includes("[<") ||
    val.includes("\x1b")
  ) {
    val = val
      .replace(/\x1b?\[200~/g, "")
      .replace(/\x1b?\[201~/g, "")
      .replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "")
      .replace(/\x1b/g, "");
  }
  /* eslint-enable no-control-regex */

  // 3. Handle unbracketed multi-line pastes if newlines remain
  if (val.includes("\n") || val.includes("\r")) {
    // Determine the newly inserted segment compared to prevQuery
    let start = 0;
    while (start < prevQuery.length && start < val.length && prevQuery[start] === val[start]) {
      start++;
    }
    let queryEnd = prevQuery.length - 1;
    let valEnd = val.length - 1;
    while (queryEnd >= start && valEnd >= start && prevQuery[queryEnd] === val[valEnd]) {
      queryEnd--;
      valEnd--;
    }

    const inserted = val.slice(start, valEnd + 1);
    const lines = getPasteLines(inserted);

    if (lines.length >= 2) {
      counterRef.current += 1;
      const token = formatPasteToken(counterRef.current, lines.length);
      registry.set(token, inserted);
      val = val.slice(0, start) + token + val.slice(valEnd + 1);
    } else {
      val = val.replace(/\r?\n/g, " ");
    }
  }

  return val;
}

/**
 * Transparently expands all collapsed tokens (`[Pasted text #N +X lines]`)
 * in text with their stored raw multi-line strings from the registry.
 */
export function expandPastedTokens(text: string, registry: Map<string, string>): string {
  if (registry.size === 0) return text;
  return text.replace(/\[Pasted text #\d+ \+\d+ (?:line|lines)\]/g, (token) => {
    return registry.get(token) ?? token;
  });
}
