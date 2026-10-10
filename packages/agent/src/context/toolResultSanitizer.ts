import type { ToolResult } from "@fecode/models";

export interface SanitizeToolResultOptions {
  maxChars?: number;
  source?: string;
  path?: string;
  command?: string;
  fence?: boolean;
}

function safeSliceHead(str: string, maxLen: number): string {
  let cut = Math.min(str.length, maxLen);
  if (cut > 0 && str.charCodeAt(cut - 1) >= 0xd800 && str.charCodeAt(cut - 1) <= 0xdbff) {
    cut--;
  }
  return str.slice(0, cut);
}

function safeSliceTail(str: string, maxLen: number): string {
  let startIndex = Math.max(0, str.length - maxLen);
  if (startIndex < str.length && str.charCodeAt(startIndex) >= 0xdc00 && str.charCodeAt(startIndex) <= 0xdfff) {
    startIndex++;
  }
  return str.slice(startIndex);
}

/**
 * Neutralizes opening and closing boundary tags to prevent adversarial content
 * from breaking out of or forging XML boundary fences.
 */
export function neutralizeFenceTags(str: string): string {
  if (!str) return str;
  return str
    .replace(/<\/?untrusted_content\b/gi, (match) => `&lt;${match.slice(1)}`)
    .replace(/<\/?untrusted_code_snippet\b/gi, (match) => `&lt;${match.slice(1)}`);
}

/**
 * Wraps untrusted text in structural XML boundary tags (<untrusted_content>).
 * Pre-emptively neutralizes any embedded fence tags within the content.
 */
export function fenceUntrustedContent(
  content: string,
  meta: { source?: string; path?: string; command?: string } = {}
): string {
  if (!content) return content;
  // NOTE: content is always neutralized and (re-)wrapped here, even if it already
  // looks fenced on its face. Adversarial content can be crafted to start with
  // "<untrusted_content" and end with "</untrusted_content>" purely as literal
  // text; trusting that shape without neutralizing it first would let a forged
  // or premature closing tag embedded inside slip through unescaped, letting
  // attacker-controlled text masquerade as sitting outside the untrusted boundary.
  const neutralized = neutralizeFenceTags(content);
  const attrs: string[] = [];
  if (meta.source) attrs.push(`source="${meta.source}"`);
  if (meta.path) attrs.push(`path="${meta.path}"`);
  if (meta.command) attrs.push(`command="${meta.command.replace(/"/g, "&quot;")}"`);
  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
  return `<untrusted_content${attrStr}>\n${neutralized}\n</untrusted_content>`;
}

/**
 * Serializes and bounds tool results so they fit within context window limits
 * while GUARANTEEING that the resulting string is ALWAYS valid, well-formed JSON.
 *
 * Additionally wraps untrusted text fields (file content, command stdout/stderr, diffs)
 * in structural XML boundary tags to defend against indirect prompt injection.
 */
export function sanitizeToolResultForContext(
  result: ToolResult<unknown> | unknown,
  options: SanitizeToolResultOptions = {}
): string {
  const maxChars = options.maxChars ?? 16000;
  const shouldFence = options.fence !== false;

  let metaSource = options.source;
  let metaPath = options.path;
  const metaCommand = options.command;

  // If it's not an object, stringify directly or slice string safely
  if (result === null || typeof result !== "object") {
    const raw = String(result);
    let body = raw;
    if (raw.length > maxChars) {
      const head = safeSliceHead(raw, Math.floor(maxChars * 0.65));
      const tail = safeSliceTail(raw, Math.floor(maxChars * 0.25));
      body = `${head}\n... [output truncated: ${raw.length - (head.length + tail.length)} characters omitted] ...\n${tail}`;
    }
    return shouldFence
      ? fenceUntrustedContent(body, { source: metaSource, path: metaPath, command: metaCommand })
      : body;
  }

  // Clone object to process fields and bound them
  const initialJson = JSON.stringify(result);
  const cloned = JSON.parse(initialJson) as Record<string, unknown>;

  // Check if it's a standard ToolResult with an output object
  if (cloned && typeof cloned === "object") {
    const output = cloned.output;

    if (output && typeof output === "object" && !Array.isArray(output)) {
      const outObj = output as Record<string, unknown>;

      if (!metaPath && typeof outObj.path === "string") {
        metaPath = outObj.path;
      }
      if (!metaSource) {
        if (typeof outObj.content === "string") {
          metaSource = "read_file";
        } else if (outObj.stdout !== undefined || outObj.stderr !== undefined) {
          metaSource = "execute_command";
        } else if (outObj.diff !== undefined) {
          metaSource = outObj.created ? "write_file" : "edit_file";
        } else if (Array.isArray(outObj.matches)) {
          metaSource = "search_files";
        }
      }

      const meta = { source: metaSource, path: metaPath, command: metaCommand };

      // Check common high-volume string fields: content, stdout, stderr, text, diff
      for (const key of ["content", "stdout", "stderr", "text", "diff"]) {
        if (typeof outObj[key] === "string") {
          let str = outObj[key] as string;
          if (str.length > 0) {
            const targetBudget = Math.max(500, maxChars - 2000);
            if (str.length > targetBudget) {
              const head = safeSliceHead(str, Math.floor(targetBudget * 0.65));
              const tail = safeSliceTail(str, Math.floor(targetBudget * 0.25));
              const omitted = str.length - (head.length + tail.length);
              str = `${head}\n... [content truncated: ${omitted} characters omitted] ...\n${tail}`;
              outObj.truncated = true;
            }
            outObj[key] = shouldFence ? fenceUntrustedContent(str, meta) : str;
          }
        }
      }

      // Check common high-volume array fields: entries, matches, files, lines
      for (const key of ["entries", "matches", "files", "lines"]) {
        if (Array.isArray(outObj[key])) {
          const arr = outObj[key] as unknown[];
          const itemEstChars = arr.length > 0 ? Math.max(20, JSON.stringify(arr[0]).length) : 40;
          const maxAllowedItems = Math.max(2, Math.floor((maxChars - 300) / itemEstChars));
          if (arr.length > maxAllowedItems) {
            outObj.totalCount = arr.length;
            outObj[key] = arr.slice(0, maxAllowedItems);
            outObj.truncated = true;
          }
        }
      }
    } else if (Array.isArray(output)) {
      const arr = output;
      const itemEstChars = arr.length > 0 ? Math.max(20, JSON.stringify(arr[0]).length) : 40;
      const maxAllowedItems = Math.max(2, Math.floor((maxChars - 300) / itemEstChars));
      if (arr.length > maxAllowedItems) {
        cloned.totalCount = arr.length;
        cloned.output = arr.slice(0, maxAllowedItems);
        cloned.truncated = true;
      }
    } else if (typeof output === "string") {
      let str = output;
      const targetBudget = Math.max(500, maxChars - 1000);
      if (str.length > targetBudget) {
        const head = str.slice(0, Math.floor(targetBudget * 0.65));
        const tail = str.slice(str.length - Math.floor(targetBudget * 0.25));
        const omitted = str.length - (head.length + tail.length);
        str = `${head}\n... [output truncated: ${omitted} characters omitted] ...\n${tail}`;
        cloned.truncated = true;
      }
      cloned.output = shouldFence
        ? fenceUntrustedContent(str, { source: metaSource, path: metaPath, command: metaCommand })
        : str;
    }

    const prunedJson = JSON.stringify(cloned);
    if (prunedJson.length <= maxChars) {
      return prunedJson;
    }
  }

  // Fallback if generic/deep object still exceeds maxChars:
  // Wrap into a structured summary that is 100% VALID JSON.
  const toolResult = result as ToolResult<unknown>;
  const isSuccess =
    toolResult && typeof toolResult === "object" && "success" in toolResult
      ? Boolean((toolResult as { success: unknown }).success)
      : true;
  const toolError =
    toolResult && typeof toolResult === "object" && "error" in toolResult
      ? (toolResult as { error: unknown }).error
      : undefined;

  const rawString =
    typeof toolResult?.output === "string"
      ? toolResult.output
      : JSON.stringify(toolResult?.output ?? result);

  const previewBudget = Math.max(300, maxChars - 300);
  const head = rawString.slice(0, Math.floor(previewBudget * 0.65));
  const tail = rawString.slice(rawString.length - Math.floor(previewBudget * 0.25));
  const omitted = rawString.length - (head.length + tail.length);
  const previewBody = `${head}\n... [truncated: ${omitted} characters omitted] ...\n${tail}`;
  const preview = shouldFence
    ? fenceUntrustedContent(previewBody, { source: metaSource, path: metaPath, command: metaCommand })
    : previewBody;

  return JSON.stringify({
    success: isSuccess,
    error: toolError,
    truncated: true,
    warning: `Tool output exceeded context budget and was safely truncated (${rawString.length} chars).`,
    preview
  });
}
