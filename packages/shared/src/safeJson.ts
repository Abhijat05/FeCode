/**
 * Creates a JSON replacer function that safely handles circular references,
 * BigInt values, Error objects, and functions without throwing exceptions.
 */
function createSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet();

  return function (this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
      return value.toString();
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }

    return value;
  };
}

/**
 * Safely stringifies a value to JSON, preventing TypeError crashes from
 * BigInt values, circular references, or unsupported data types.
 */
export function safeJsonStringify(
  value: unknown,
  space?: number | string
): string {
  try {
    return JSON.stringify(value, createSafeReplacer(), space);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({
      error: "SerializationError",
      message: `Failed to safely serialize payload to JSON: ${message}`
    });
  }
}

/**
 * Creates a safe, deep JSON-serializable clone of a value by passing it
 * through safeJsonStringify and JSON.parse.
 */
export function safeJsonClone<T = Record<string, unknown>>(value: unknown): T {
  const stringified = safeJsonStringify(value);
  try {
    return JSON.parse(stringified) as T;
  } catch {
    return {} as T;
  }
}
