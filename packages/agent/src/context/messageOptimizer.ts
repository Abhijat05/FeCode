import type { ModelMessage } from "@fecode/models";
import { estimateTokens } from "../optimization/estimator.js";

export interface PrepareModelMessagesOptions {
  maxToolResultChars?: number;
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
  if (messages.length === 0) return [];

  const maxToolChars = options.maxToolResultChars ?? 3500;

  // Step 1: Clean each message (strip think tags from assistant, truncate oversized tool results)
  const cleanedMessages: ModelMessage[] = messages.map((m) => {
    // Strip thinking tags from assistant messages
    if (m.role === "assistant" && m.content) {
      const sanitized = m.content
        .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/g, "")
        .trim();
      return {
        ...m,
        content: sanitized || (m.toolCalls?.length ? undefined : "")
      };
    }

    // Truncate oversized tool results
    if (m.role === "tool" && m.content && m.content.length > maxToolChars) {
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

  let currentTokens = estimateMessageTokens(cleanedMessages);
  if (currentTokens <= maxBudgetTokens) {
    return cleanedMessages;
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

  // If there is only one user message (or none), we can't drop earlier turns
  if (lastUserIdx <= 0) {
    return cleanedMessages;
  }

  // Identify turn boundaries (indices of all messages with role: "user")
  const userIndices: number[] = [];
  for (let i = 0; i < lastUserIdx; i++) {
    if (cleanedMessages[i].role === "user") {
      userIndices.push(i);
    }
  }

  // Try dropping turns from oldest to newest until within budget
  for (const cutoffIdx of userIndices) {
    const candidateMessages: ModelMessage[] = [
      {
        role: "user",
        content: "[Context notice: Earlier conversation history was compacted to fit within the model context budget.]"
      },
      {
        role: "assistant",
        content: "Understood. I have the context of the recent discussion and will continue."
      },
      ...cleanedMessages.slice(cutoffIdx)
    ];

    currentTokens = estimateMessageTokens(candidateMessages);
    if (currentTokens <= maxBudgetTokens) {
      return candidateMessages;
    }
  }

  // If still over budget, retain only the active turn from lastUserIdx
  const finalActiveTurn: ModelMessage[] = [
    {
      role: "user",
      content: "[Context notice: Earlier conversation history was compacted to fit within the model context budget.]"
    },
    {
      role: "assistant",
      content: "Understood. I will proceed with your latest request."
    },
    ...cleanedMessages.slice(lastUserIdx)
  ];

  return finalActiveTurn;
}
