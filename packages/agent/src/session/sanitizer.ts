import type { ModelMessage } from "@fecode/models";

export function sanitizeText(text: string): string {
  if (!text) return text;
  let sanitized = text;

  // Replace specific key-value assignments
  sanitized = sanitized.replace(
    /\b(OPENAI_API_KEY|GEMINI_API_KEY|API_KEY|AUTHORIZATION|ACCESS_TOKEN|SECRET_KEY)\s*[:=]\s*["']?([^"' \n\r\t,;]{6,})["']?/gi,
    "$1=[REDACTED_SECRET]"
  );

  // Replace OpenAI / Gemini keys
  sanitized = sanitized.replace(/\bsk-[a-zA-Z0-9_-]{20,}\b/g, "[REDACTED_SECRET]");
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_SECRET]");
  sanitized = sanitized.replace(/\bBearer\s+[a-zA-Z0-9_.-]{20,}\b/gi, "Bearer [REDACTED_SECRET]");

  return sanitized;
}

export function sanitizeMessage(message: ModelMessage): ModelMessage {
  const sanitized: ModelMessage = {
    ...message
  };

  if (typeof sanitized.content === "string") {
    sanitized.content = sanitizeText(sanitized.content);
  }

  if (sanitized.toolCalls && sanitized.toolCalls.length > 0) {
    sanitized.toolCalls = sanitized.toolCalls.map((call) => {
      let argsString = "";
      try {
        argsString = JSON.stringify(call.arguments);
      } catch {
        argsString = String(call.arguments);
      }
      const sanitizedArgs = sanitizeText(argsString);
      let parsedArgs = call.arguments;
      try {
        parsedArgs = JSON.parse(sanitizedArgs);
      } catch {
        // retain sanitized string representation
      }

      return {
        ...call,
        arguments: parsedArgs
      };
    });
  }

  return sanitized;
}

export function sanitizeMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => sanitizeMessage(m));
}
