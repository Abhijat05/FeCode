import * as crypto from "crypto";

export function createContentHash(content: string): string {
  if (typeof content !== "string") {
    return "";
  }
  // Normalize CRLF to LF for deterministic hashing across platforms
  const normalized = content.replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(normalized, "utf-8").digest("hex");
}
