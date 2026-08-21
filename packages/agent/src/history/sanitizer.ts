import type { DurableRunRecord } from "./types.js";

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    // OpenAI API keys
    pattern: /sk-[a-zA-Z0-9_-]{20,}/g,
    replacement: "[REDACTED_API_KEY]"
  },
  {
    // Gemini API keys
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    replacement: "[REDACTED_API_KEY]"
  },
  {
    // GitHub personal/app tokens
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g,
    replacement: "[REDACTED_TOKEN]"
  },
  {
    // Bearer tokens
    pattern: /Bearer\s+[a-zA-Z0-9_.-]{16,}/gi,
    replacement: "Bearer [REDACTED_TOKEN]"
  },
  {
    // RSA / OpenSSH / EC private keys
    pattern: /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  {
    // Generic API Key / Token / Secret / Password in assignment or env var format
    pattern: /(?:OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|SECRET_KEY|PASSWORD|TOKEN)\s*[:=]\s*[^\s,;"']+/gi,
    replacement: "[REDACTED_ENV_VAR]"
  }
];

export function sanitizeHistoryString(str: string): string {
  if (!str || typeof str !== "string") return str;
  let result = str;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeHistoryString(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      copy[key] = sanitizeObject(value);
    }
    return copy as T;
  }

  return obj;
}

export function sanitizeDurableRunRecord(
  record: DurableRunRecord
): DurableRunRecord {
  const cloned = JSON.parse(JSON.stringify(record)) as DurableRunRecord;
  return sanitizeObject(cloned);
}
