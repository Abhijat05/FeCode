export type ProviderErrorCategory =
  | "quota_exhaustion"
  | "rate_limit"
  | "transient_network"
  | "authentication"
  | "invalid_request"
  | "unsupported_model"
  | "cancelled"
  | "permission_denied"
  | "internal_error";

export interface ProviderErrorClassification {
  category: ProviderErrorCategory;
  isFallbackEligible: boolean;
  isRetryable: boolean;
  statusCode?: number;
  code?: string;
  reason: string;
}

export function classifyProviderError(err: unknown): ProviderErrorClassification {
  if (!err) {
    return {
      category: "internal_error",
      isFallbackEligible: false,
      isRetryable: false,
      reason: "Unknown empty error"
    };
  }

  const errorObj = err as Record<string, unknown>;
  const name = typeof errorObj.name === "string" ? errorObj.name : "";
  const rawMessage = typeof errorObj.message === "string" ? errorObj.message : String(err);
  const lowerMessage = rawMessage.toLowerCase();

  // Extract HTTP status code if present
  let statusCode: number | undefined;
  if (typeof errorObj.status === "number") {
    statusCode = errorObj.status;
  } else if (typeof errorObj.statusCode === "number") {
    statusCode = errorObj.statusCode;
  } else {
    const statusMatch = rawMessage.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
    }
  }

  // Extract error code if present
  let code: string | undefined;
  if (typeof errorObj.code === "string") {
    code = errorObj.code;
  } else if (errorObj.error && typeof (errorObj.error as Record<string, unknown>).code === "string") {
    code = (errorObj.error as Record<string, unknown>).code as string;
  }

  // 1. Cancellation / Abort
  if (
    name === "AbortError" ||
    lowerMessage.includes("aborted") ||
    lowerMessage.includes("cancelled") ||
    lowerMessage.includes("request was aborted")
  ) {
    return {
      category: "cancelled",
      isFallbackEligible: false,
      isRetryable: false,
      statusCode,
      code,
      reason: "Request was cancelled or aborted"
    };
  }

  // 2. Fallback-eligible Quota Exhaustion & Rate Limiting
  if (
    code === "insufficient_quota" ||
    lowerMessage.includes("insufficient_quota") ||
    lowerMessage.includes("resource_exhausted") ||
    lowerMessage.includes("resourceexhausted") ||
    lowerMessage.includes("quota exceeded") ||
    lowerMessage.includes("exceeded your current quota") ||
    lowerMessage.includes("billing details")
  ) {
    return {
      category: "quota_exhaustion",
      isFallbackEligible: true,
      isRetryable: false,
      statusCode: statusCode ?? 429,
      code: code ?? "quota_exhausted",
      reason: rawMessage
    };
  }

  if (
    statusCode === 429 ||
    code === "rate_limit_exceeded" ||
    lowerMessage.includes("rate_limit") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests")
  ) {
    return {
      category: "rate_limit",
      isFallbackEligible: true,
      isRetryable: false,
      statusCode: 429,
      code: code ?? "rate_limit_exceeded",
      reason: rawMessage
    };
  }

  // 3. Authentication & Authorization (Non-fallback)
  if (
    statusCode === 401 ||
    code === "invalid_api_key" ||
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("invalid api key") ||
    lowerMessage.includes("api_key_invalid") ||
    lowerMessage.includes("incorrect api key") ||
    lowerMessage.includes("authentication")
  ) {
    return {
      category: "authentication",
      isFallbackEligible: false,
      isRetryable: false,
      statusCode: statusCode ?? 401,
      code: code ?? "unauthorized",
      reason: rawMessage
    };
  }

  if (
    statusCode === 403 ||
    lowerMessage.includes("permission denied") ||
    lowerMessage.includes("forbidden") ||
    lowerMessage.includes("access denied")
  ) {
    return {
      category: "permission_denied",
      isFallbackEligible: false,
      isRetryable: false,
      statusCode: statusCode ?? 403,
      code: code ?? "forbidden",
      reason: rawMessage
    };
  }

  // 4. Model Availability / Not Found (Non-fallback)
  if (
    statusCode === 404 ||
    lowerMessage.includes("model not found") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("unknown model")
  ) {
    return {
      category: "unsupported_model",
      isFallbackEligible: false,
      isRetryable: false,
      statusCode: statusCode ?? 404,
      code: code ?? "model_not_found",
      reason: rawMessage
    };
  }

  // 5. Invalid Request / Validation (Non-fallback)
  if (
    statusCode === 400 ||
    lowerMessage.includes("bad request") ||
    lowerMessage.includes("invalid parameter") ||
    lowerMessage.includes("validation error")
  ) {
    return {
      category: "invalid_request",
      isFallbackEligible: false,
      isRetryable: false,
      statusCode: statusCode ?? 400,
      code: code ?? "invalid_request",
      reason: rawMessage
    };
  }

  // 6. Transient Network Failures (Retryable on same provider, but NOT fallback-required)
  if (
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("bad gateway") ||
    lowerMessage.includes("service unavailable") ||
    lowerMessage.includes("gateway timeout") ||
    lowerMessage.includes("network error") ||
    lowerMessage.includes("fetch failed")
  ) {
    return {
      category: "transient_network",
      isFallbackEligible: false,
      isRetryable: true,
      statusCode,
      code,
      reason: rawMessage
    };
  }

  // 7. Generic Internal / Programming Error (Non-fallback)
  return {
    category: "internal_error",
    isFallbackEligible: false,
    isRetryable: false,
    statusCode,
    code,
    reason: rawMessage
  };
}
