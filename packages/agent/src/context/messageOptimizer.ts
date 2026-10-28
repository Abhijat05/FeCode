import type { ModelMessage } from "@fecode/models";
import { estimateTokens } from "../optimization/estimator.js";
import { sanitizeToolResultForContext } from "./toolResultSanitizer.js";

export interface OptimizeModelMessagesResult {
  messages: ModelMessage[];
  compacted: boolean;
  droppedTurnsCount?: number;
  savedTokens?: number;
}

export interface PrepareModelMessagesOptions {
  maxToolResultChars?: number;
  summarizeCompactedTurns?: (messages: ModelMessage[]) => string;
}

export function extractCompactedHistorySummary(
  droppedMessages: ModelMessage[],
  customSummarizer?: (messages: ModelMessage[]) => string
): string {
  if (customSummarizer) {
    try {
      const custom = customSummarizer(droppedMessages);
      if (custom && custom.trim()) {
        return custom.trim();
      }
    } catch {
      // Fallback to structured extractor
    }
  }

  const userGoals: string[] = [];
  const modifiedFiles = new Set<string>();
  const readFiles = new Set<string>();
  const commandsRun = new Set<string>();

  for (const msg of droppedMessages) {
    if (msg.role === "user" && msg.content) {
      const firstLine = msg.content.trim().split(/\r?\n/)[0]?.trim();
      const taskSummary = firstLine ? firstLine.replace(/^Turn\s+\d+:\s*/i, "").trim() : "";
      if (taskSummary && !firstLine?.startsWith("[Context notice")) {
        userGoals.push(taskSummary.length > 80 ? taskSummary.slice(0, 80) + "..." : taskSummary);
      }
    }

    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const args = (tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {}) as Record<string, unknown>;
        const filePath = (args.path || args.filePath || args.targetFile || args.file) as string | undefined;
        if (filePath && typeof filePath === "string") {
          if (tc.name === "edit_file" || tc.name === "write_file") {
            modifiedFiles.add(filePath);
          } else if (tc.name === "read_file") {
            readFiles.add(filePath);
          }
        }
        if (tc.name === "execute_command" && typeof args.command === "string") {
          commandsRun.add(args.command.length > 50 ? args.command.slice(0, 50) + "..." : args.command);
        }
      }
    }
  }

  const sections: string[] = [];
  if (userGoals.length > 0) {
    sections.push("• Previous Tasks:\n" + userGoals.slice(0, 10).map((g) => `  - ${g}`).join("\n"));
  }
  if (modifiedFiles.size > 0) {
    sections.push("• Modified Files:\n" + Array.from(modifiedFiles).slice(0, 10).map((f) => `  - ${f}`).join("\n"));
  }
  if (readFiles.size > 0) {
    sections.push("• Examined Files:\n" + Array.from(readFiles).slice(0, 10).map((f) => `  - ${f}`).join("\n"));
  }
  if (commandsRun.size > 0) {
    sections.push("• Executed Commands:\n" + Array.from(commandsRun).slice(0, 10).map((c) => `  - ${c}`).join("\n"));
  }

  if (sections.length === 0) {
    return "";
  }

  return `[Structured Context Digest of Compacted Turns]\n${sections.join("\n")}`;
}

/**
 * Bounds and compacts message history before sending to the model provider, returning
 * optimization metadata (compacted, droppedTurnsCount, savedTokens).
 */
/**
 * Strips <think>...</think> and <thinking>...</thinking> blocks in strictly linear O(N) time
 * using index slicing without regular expressions, eliminating polynomial ReDoS vulnerabilities.
 */
export function stripThinkingTags(content: string): string {
  if (!content) return content;
  const tags = [
    { open: "<think>", close: "</think>" },
    { open: "<thinking>", close: "</thinking>" }
  ];

  let result = content;
  for (const { open, close } of tags) {
    const lowerOpen = open.toLowerCase();
    const lowerClose = close.toLowerCase();
    while (true) {
      const lower = result.toLowerCase();
      const startIdx = lower.indexOf(lowerOpen);
      if (startIdx === -1) break;

      const endIdx = lower.indexOf(lowerClose, startIdx + lowerOpen.length);
      if (endIdx === -1) {
        // Tag is unclosed; strip from startIdx to end of string
        result = result.slice(0, startIdx);
        break;
      }

      result = result.slice(0, startIdx) + result.slice(endIdx + lowerClose.length);
    }
  }
  return result;
}

export function optimizeModelMessages(
  messages: ModelMessage[],
  maxBudgetTokens: number = 16384,
  options: PrepareModelMessagesOptions = {}
): OptimizeModelMessagesResult {
  if (messages.length === 0) {
    return { messages: [], compacted: false };
  }

  const defaultMaxToolChars = Math.max(
    3500,
    Math.min(120_000, Math.floor(maxBudgetTokens * 2.5))
  );
  const maxToolChars = options.maxToolResultChars ?? defaultMaxToolChars;

  // Step 1: Clean each message (strip think tags from assistant, truncate oversized tool results)
  const cleanedMessages: ModelMessage[] = messages.map((m) => {
    // Strip thinking tags from assistant messages
    if (m.role === "assistant" && m.content) {
      const sanitized = stripThinkingTags(m.content).trim();
      return {
        ...m,
        content: sanitized || (m.toolCalls?.length ? undefined : "")
      };
    }

    // Truncate oversized tool results
    if (m.role === "tool" && m.content && m.content.length > maxToolChars) {
      try {
        const parsed = JSON.parse(m.content);
        return {
          ...m,
          content: sanitizeToolResultForContext(parsed, { maxChars: maxToolChars })
        };
      } catch {
        // Plain text fallback
        const originalLen = m.content.length;
        const headLen = Math.floor(maxToolChars * 0.65);
        const tailLen = Math.floor(maxToolChars * 0.25);
        const head = m.content.slice(0, headLen);
        const tail = m.content.slice(originalLen - tailLen);
        const omitted = originalLen - (headLen + tailLen);
        const truncatedNotice = `\n... [output truncated for context budget: ${omitted} characters omitted] ...\n`;
        return {
          ...m,
          content: head + truncatedNotice + tail
        };
      }
    }

    return { ...m };
  });

  // Step 2: Estimate token cost
  const estimateMessageTokens = (msgs: ModelMessage[]): number => {
    let total = 0;
    for (const msg of msgs) {
      if (msg.content) {
        total += estimateTokens(msg.content);
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        total += msg.toolCalls.reduce(
          (acc, tc) =>
            acc +
            estimateTokens(
              typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments || {})
            ) +
            20,
          0
        );
      }
      total += 10; // Message structure overhead
    }
    return total;
  };

  const initialTokens = estimateMessageTokens(cleanedMessages);
  if (initialTokens <= maxBudgetTokens) {
    return { messages: cleanedMessages, compacted: false };
  }

  // Step 3: We are over budget. Find the start of the current active turn.
  // The current active turn is from the last user message onwards.
  let lastUserIdx = -1;
  for (let i = cleanedMessages.length - 1; i >= 0; i--) {
    if (cleanedMessages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  // If there is only one user message (or none), we can't drop earlier turns.
  // Compact older tool results in the active turn if over budget.
  if (lastUserIdx <= 0) {
    const compactedMsgs = compactOlderToolResults(cleanedMessages, maxBudgetTokens, estimateMessageTokens);
    const finalTokens = estimateMessageTokens(compactedMsgs);
    const wasCompacted = finalTokens < initialTokens;
    return {
      messages: compactedMsgs,
      compacted: wasCompacted,
      droppedTurnsCount: 0,
      savedTokens: wasCompacted ? initialTokens - finalTokens : 0
    };
  }

  // Identify turn boundaries (indices of all messages with role: "user" except index 0)
  const userIndices: number[] = [];
  for (let i = 1; i < lastUserIdx; i++) {
    if (cleanedMessages[i].role === "user") {
      userIndices.push(i);
    }
  }

  // Try dropping turns from oldest to newest until within budget
  for (const cutoffIdx of userIndices) {
    const dropped = cleanedMessages.slice(0, cutoffIdx);
    const droppedUserTurns = dropped.filter((m) => m.role === "user").length;
    const summary = extractCompactedHistorySummary(dropped, options.summarizeCompactedTurns);
    const noticeContent = summary
      ? `[Context notice: Earlier conversation history was compacted to fit within the model context budget.]\n\n${summary}`
      : `[Context notice: Earlier conversation history was compacted to fit within the model context budget.]`;

    const candidateMessages: ModelMessage[] = [
      {
        role: "user",
        content: noticeContent
      },
      {
        role: "assistant",
        content: "Understood. I have absorbed the context of earlier tasks and touched files and will continue."
      },
      ...cleanedMessages.slice(cutoffIdx)
    ];

    const currentTokens = estimateMessageTokens(candidateMessages);
    if (currentTokens <= maxBudgetTokens) {
      return {
        messages: candidateMessages,
        compacted: true,
        droppedTurnsCount: Math.max(1, droppedUserTurns),
        savedTokens: Math.max(0, initialTokens - currentTokens)
      };
    }
  }

  // If still over budget, retain only the active turn from lastUserIdx
  const dropped = cleanedMessages.slice(0, lastUserIdx);
  const droppedUserTurns = dropped.filter((m) => m.role === "user").length;
  const summary = extractCompactedHistorySummary(dropped, options.summarizeCompactedTurns);
  const noticeContent = summary
    ? `[Context notice: Earlier conversation history was compacted to fit within the model context budget.]\n\n${summary}`
    : `[Context notice: Earlier conversation history was compacted to fit within the model context budget.]`;

  const finalActiveTurn: ModelMessage[] = [
    {
      role: "user",
      content: noticeContent
    },
    {
      role: "assistant",
      content: "Understood. I have absorbed the context of earlier tasks and touched files and will proceed with your latest request."
    },
    ...cleanedMessages.slice(lastUserIdx)
  ];

  const candidateTokens = estimateMessageTokens(finalActiveTurn);
  if (candidateTokens > maxBudgetTokens) {
    const finalMsgs = compactOlderToolResults(finalActiveTurn, maxBudgetTokens, estimateMessageTokens);
    const finalTokens = estimateMessageTokens(finalMsgs);
    return {
      messages: finalMsgs,
      compacted: true,
      droppedTurnsCount: Math.max(1, droppedUserTurns),
      savedTokens: Math.max(0, initialTokens - finalTokens)
    };
  }

  return {
    messages: finalActiveTurn,
    compacted: true,
    droppedTurnsCount: Math.max(1, droppedUserTurns),
    savedTokens: Math.max(0, initialTokens - candidateTokens)
  };
}

/**
 * Prepares and bounds the message history before sending to the model provider.
 * Ensures:
 * 1. Internal thinking tags (<think>...</think>) from earlier assistant turns are stripped so they don't bloat the context window.
 * 2. Excessively large tool results (e.g. huge file reads or command outputs) are safely truncated while retaining head and tail.
 * 3. If total estimated tokens exceed the budget, older turns are compacted starting at clean turn boundaries (role: "user")
 *    while strictly preserving:
 *    - The current active turn (the latest user message and all subsequent assistant/tool messages in the current loop)
 *    - Pairing of tool calls with tool results to avoid API protocol errors.
 */
export function prepareModelMessages(
  messages: ModelMessage[],
  maxBudgetTokens: number = 16384,
  options: PrepareModelMessagesOptions = {}
): ModelMessage[] {
  return optimizeModelMessages(messages, maxBudgetTokens, options).messages;
}

/**
 * Compacts older tool results in an active turn or message list when token budget is exceeded.
 * Strictly preserves tool call and tool result message pairings to satisfy API requirements,
 * while replacing bloated older tool outputs with concise notices.
 */
function compactOlderToolResults(
  msgs: ModelMessage[],
  maxBudgetTokens: number,
  estimateFn: (msgs: ModelMessage[]) => number
): ModelMessage[] {
  let currentTokens = estimateFn(msgs);
  if (currentTokens <= maxBudgetTokens) {
    return msgs;
  }

  const result = msgs.map((m) => ({ ...m }));
  const toolIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i].role === "tool" && result[i].content) {
      toolIndices.push(i);
    }
  }

  // Compact older tool results from oldest to newest.
  // Preserve the latest tool result untouched if possible so the model has recent context.
  const limit = Math.max(0, toolIndices.length - 1);
  for (let i = 0; i < limit; i++) {
    const idx = toolIndices[i];
    const msg = result[idx];
    if (!msg.content || msg.content.includes("omitted for context budget")) {
      continue;
    }
    const preview = msg.content.slice(0, 100).trim();
    const compacted = preview
      ? `${preview}\n... [earlier tool output omitted for context budget; tool execution completed]`
      : `[earlier tool output omitted for context budget; tool execution completed]`;

    result[idx] = {
      ...msg,
      content: compacted
    };

    currentTokens = estimateFn(result);
    if (currentTokens <= maxBudgetTokens) {
      break;
    }
  }

  return result;
}