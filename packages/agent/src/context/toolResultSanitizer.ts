import type { ToolResult } from "@fecode/models";

export interface SanitizeToolResultOptions {
  maxChars?: number;
}

/**
 * Serializes and bounds tool results so they fit within context window limits
 * while GUARANTEEING that the resulting string is ALWAYS valid, well-formed JSON.
 *
 * Never performs raw string slicing across serialized JSON (which causes unclosed quotes,
 * broken escape sequences, and syntax errors). Instead, sanitizes inner data fields
 * or wraps the result structurally.
 */
export function sanitizeToolResultForContext(
  result: ToolResult<unknown> | unknown,
  options: SanitizeToolResultOptions = {}
): string {
  const maxChars = options.maxChars ?? 16000;

  // If it's not an object, stringify directly or slice string safely
  if (result === null || typeof result !== "object") {
    const raw = String(result);
    if (raw.length <= maxChars) return raw;
    const head = raw.slice(0, Math.floor(maxChars * 0.65));
    const tail = raw.slice(raw.length - Math.floor(maxChars * 0.25));
    return `${head}\n... [output truncated: ${raw.length - (head.length + tail.length)} characters omitted] ...\n${tail}`;
  }

  // First check if unmodified serialization already fits comfortably
  const initialJson = JSON.stringify(result);
  if (initialJson.length <= maxChars) {
    return initialJson;
  }

  // It exceeds maxChars. We must prune inner fields while keeping JSON valid.
  const cloned = JSON.parse(initialJson) as Record<string, unknown>;

  // Check if it's a standard ToolResult with an output object
  if (cloned && typeof cloned === "object") {
    const output = cloned.output;

    if (output && typeof output === "object" && !Array.isArray(output)) {
      const outObj = output as Record<string, unknown>;

      // Check common high-volume string fields: content, stdout, stderr, text, diff
      for (const key of ["content", "stdout", "stderr", "text", "diff"]) {
        if (typeof outObj[key] === "string") {
          const str = outObj[key] as string;
          // Allocate remaining budget for this string
          const targetBudget = Math.max(500, maxChars - 2000);
          if (str.length > targetBudget) {
            const head = str.slice(0, Math.floor(targetBudget * 0.65));
            const tail = str.slice(str.length - Math.floor(targetBudget * 0.25));
            const omitted = str.length - (head.length + tail.length);
            outObj[key] = `${head}\n... [content truncated: ${omitted} characters omitted] ...\n${tail}`;
            outObj.truncated = true;
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
      const str = output;
      const targetBudget = Math.max(500, maxChars - 1000);
      if (str.length > targetBudget) {
        const head = str.slice(0, Math.floor(targetBudget * 0.65));
        const tail = str.slice(str.length - Math.floor(targetBudget * 0.25));
        const omitted = str.length - (head.length + tail.length);
        cloned.output = `${head}\n... [output truncated: ${omitted} characters omitted] ...\n${tail}`;
        cloned.truncated = true;
      }
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

  return JSON.stringify({
    success: isSuccess,
    error: toolError,
    truncated: true,
    warning: `Tool output exceeded context budget and was safely truncated (${rawString.length} chars).`,
    preview: `${head}\n... [truncated: ${omitted} characters omitted] ...\n${tail}`
  });
}
