/**
 * Sanitizes an API key string:
 * - Strips ANSI escape sequences and terminal bracketed-paste markers
 * - Strips leading environment variable assignments (e.g. `export GEMINI_API_KEY=`, `OPENAI_API_KEY=`)
 * - Strips surrounding single, double, backtick, or smart curly quotes
 * - Strips all non-printable ASCII control characters (0x00-0x1F, 0x7F) including \r, \n, \t
 * - Strips invisible Unicode characters (BOM \uFEFF, zero-width spaces \u200B-\u200D, \u2060)
 * - Trims leading/trailing whitespace
 */
export function sanitizeApiKey(raw?: string | null): string {
  if (!raw || typeof raw !== "string") {
    return "";
  }

  let key = raw.trim();

  // Strip ANSI escape sequences & bracketed paste markers
  // eslint-disable-next-line no-control-regex
  key = key.replace(/\x1b\[[0-9;]*[a-zA-Z~]/g, "").replace(/\[20[01]~/g, "");

  // Strip common env / config assignment prefixes if the user copied the whole line:
  // e.g. "export GEMINI_API_KEY=...", "GEMINI_API_KEY=...", "apiKey: ..."
  key = key.replace(/^(?:export\s+)?[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|APIKEY)\s*[:=]\s*/i, "");

  // Strip non-printable ASCII control characters (bytes 0-31 and 127) including \r, \n, \t
  // eslint-disable-next-line no-control-regex
  key = key.replace(/[\x00-\x1F\x7F]/g, "");

  // Strip zero-width and invisible Unicode characters
  key = key.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");

  key = key.trim();

  // Strip surrounding quotes (double, single, backtick, smart quotes)
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201C", "\u201D"], // “ ”
    ["\u2018", "\u2019"]  // ‘ ’
  ];

  let changed = true;
  while (changed && key.length >= 2) {
    changed = false;
    for (const [open, close] of quotePairs) {
      if (key.startsWith(open) && key.endsWith(close)) {
        key = key.slice(open.length, key.length - close.length).trim();
        changed = true;
        break;
      }
    }
  }

  // Any remaining stray single leading or trailing quotation marks
  key = key.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, "").trim();

  return key;
}

/**
 * Sanitizes a base URL string:
 * - Trims whitespace
 * - Strips ANSI escape sequences
 * - Strips surrounding quotes
 * - Strips control characters
 * - Strips trailing slashes (except for root `/`)
 */
export function sanitizeBaseUrl(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== "string") {
    return undefined;
  }

  let url = raw.trim();

  // Strip ANSI escape sequences & bracketed paste markers
  // eslint-disable-next-line no-control-regex
  url = url.replace(/\x1b\[[0-9;]*[a-zA-Z~]/g, "").replace(/\[20[01]~/g, "");

  // Strip env assignment prefix like "export BASE_URL=..."
  url = url.replace(/^(?:export\s+)?[A-Za-z0-9_]*(?:URL|ENDPOINT|HOST)\s*[:=]\s*/i, "");

  // Strip non-printable control characters
  // eslint-disable-next-line no-control-regex
  url = url.replace(/[\x00-\x1F\x7F]/g, "");
  url = url.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");

  url = url.trim();

  // Strip surrounding quotes
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201C", "\u201D"],
    ["\u2018", "\u2019"]
  ];

  for (const [open, close] of quotePairs) {
    if (url.startsWith(open) && url.endsWith(close) && url.length >= 2) {
      url = url.slice(open.length, url.length - close.length).trim();
      break;
    }
  }

  url = url.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, "").trim();

  if (!url) {
    return undefined;
  }

  // Strip trailing slashes while preserving root http://localhost/ -> http://localhost
  url = url.replace(/\/+$/, "");

  return url;
}
