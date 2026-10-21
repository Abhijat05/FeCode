/**
 * Centralized Terminal Symbols Design System
 * Pure Unicode geometric glyphs — strictly zero graphic emojis.
 */
export const symbols = Object.freeze({
  /** Modern interactive prompt glyph */
  prompt: "❯",
  /** Success / completed task */
  tick: "✔",
  /** Failure / error / rejection */
  cross: "✖",
  /** State indicator dot (active, running, live) */
  dot: "●",
  /** Idle / pending circle */
  circle: "○",
  /** In-progress / executing step pointer */
  play: "▶",
  /** Verification loop indicator */
  verifying: "◎",
  /** Left rail gutter for stream indentations */
  rail: "│",
  /** Subtle horizontal rule divider */
  rule: "─",
  /** Directional arrow indicator */
  arrow: "→",
  /** Warning / risk / approval alert */
  warning: "⚠",
  /** Cancelled / skipped / blocked badge */
  cancelled: "⊘",
  /** Bullet for lists and metadata */
  bullet: "•",
  /** Streaming / thinking ellipsis */
  ellipsis: "…"
} as const);

export type SymbolName = keyof typeof symbols;
