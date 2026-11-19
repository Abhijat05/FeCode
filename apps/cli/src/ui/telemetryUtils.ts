export function getModelContextLimit(modelName?: string, providerName?: string): number {
  const model = (modelName || "").toLowerCase();
  const provider = (providerName || "").toLowerCase();

  if (provider === "gemini" || model.includes("gemini")) {
    return 1_000_000;
  }
  if (model.includes("gpt-4o") || model.includes("gpt-4-turbo")) {
    return 128_000;
  }
  if (model.includes("claude-3-5") || model.includes("claude-3") || model.includes("claude")) {
    return 200_000;
  }
  if (model.includes("deepseek") || model.includes("qwen") || model.includes("mistral")) {
    return 128_000;
  }
  return 128_000;
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 0 || isNaN(tokens)) return "0";
  if (tokens < 1000) return `${Math.round(tokens)}`;
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = tokens / 1_000_000;
  return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

export interface TokenTelemetryResult {
  text: string;
  percent: number;
  color: "cyan" | "yellow" | "red" | "gray";
}

export function formatTokenTelemetry(
  currentTokens: number,
  limit: number,
  layout: "wide" | "medium" | "narrow" | "very_narrow" = "wide"
): TokenTelemetryResult {
  const safeTokens = Math.max(0, currentTokens || 0);
  const safeLimit = Math.max(1, limit || 128_000);
  const percent = Math.min(100, Math.round((safeTokens / safeLimit) * 100));

  let color: "cyan" | "yellow" | "red" | "gray" = "cyan";
  if (percent >= 85) {
    color = "red";
  } else if (percent >= 65) {
    color = "yellow";
  } else if (safeTokens === 0) {
    color = "gray";
  }

  let text = "";
  if (layout === "wide") {
    text = `${formatTokenCount(safeTokens)}/${formatTokenCount(safeLimit)} tokens (${percent}%)`;
  } else if (layout === "medium") {
    text = `${formatTokenCount(safeTokens)}/${formatTokenCount(safeLimit)} (${percent}%)`;
  } else if (layout === "narrow") {
    text = `${formatTokenCount(safeTokens)} tokens`;
  } else {
    text = "";
  }

  return { text, percent, color };
}
