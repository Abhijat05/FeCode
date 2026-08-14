/**
 * Deterministic token estimation heuristic (~4 characters per token).
 *
 * NOTE: This is a fast, deterministic character-based approximation, not an exact
 * model-specific tokenizer (BPE / SentencePiece) count. Its purpose is lightweight
 * budget enforcement, regression tracking, and context reduction triggers without
 * introducing external tokenizer dependencies.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
