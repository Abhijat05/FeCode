import { describe, it, expect } from "vitest";
import { classifyProviderError } from "./classification.js";

describe("Provider Error Classification", () => {
  describe("Fallback-eligible errors (Quota exhaustion / Rate limit)", () => {
    it("classifies HTTP 429 status code as fallback-eligible quota/rate-limit", () => {
      const err = Object.assign(new Error("Too many requests"), { status: 429 });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(true);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("rate_limit");
      expect(result.statusCode).toBe(429);
    });

    it("classifies RESOURCE_EXHAUSTED message from Gemini as quota_exhaustion", () => {
      const err = new Error("Gemini quota exceeded or rate limit reached (429 ResourceExhausted). Please wait a moment before retrying.");
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(true);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("quota_exhaustion");
    });

    it("classifies OpenAI insufficient_quota error as quota_exhaustion", () => {
      const err = Object.assign(new Error("You exceeded your current quota, please check your plan and billing details."), {
        code: "insufficient_quota",
        status: 429
      });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(true);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("quota_exhaustion");
      expect(result.code).toBe("insufficient_quota");
    });

    it("classifies rate limit reached message as rate_limit", () => {
      const err = new Error("Rate limit reached for requests per minute (429 RateLimit). Please wait a moment before retrying.");
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(true);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("rate_limit");
    });
  });

  describe("Retryable but not fallback-required errors (Transient network)", () => {
    it("classifies 503 Service Unavailable as retryable transient network failure", () => {
      const err = Object.assign(new Error("Service Unavailable"), { status: 503 });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(true);
      expect(result.category).toBe("transient_network");
      expect(result.statusCode).toBe(503);
    });

    it("classifies 502 Bad Gateway as retryable transient network failure", () => {
      const err = Object.assign(new Error("Bad Gateway"), { status: 502 });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(true);
      expect(result.category).toBe("transient_network");
    });

    it("classifies ECONNRESET and ETIMEDOUT network errors as transient", () => {
      const err1 = new Error("read ECONNRESET");
      const res1 = classifyProviderError(err1);
      expect(res1.isFallbackEligible).toBe(false);
      expect(res1.isRetryable).toBe(true);
      expect(res1.category).toBe("transient_network");

      const err2 = new Error("connect ETIMEDOUT 127.0.0.1:11434");
      const res2 = classifyProviderError(err2);
      expect(res2.isFallbackEligible).toBe(false);
      expect(res2.isRetryable).toBe(true);
      expect(res2.category).toBe("transient_network");
    });
  });

  describe("Non-fallback errors", () => {
    it("classifies 401 Unauthorized / invalid API key as authentication error (non-fallback, non-retryable)", () => {
      const err = Object.assign(new Error("Gemini API key is invalid or unauthorized. Please check your GEMINI_API_KEY"), {
        status: 401
      });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("authentication");
      expect(result.statusCode).toBe(401);
    });

    it("classifies 400 Bad Request as invalid_request error (non-fallback, non-retryable)", () => {
      const err = Object.assign(new Error("Invalid parameters provided: max_tokens out of range"), {
        status: 400
      });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("invalid_request");
    });

    it("classifies 404 Model Not Found as unsupported_model error", () => {
      const err = Object.assign(new Error("Model 'nonexistent-model' not found"), {
        status: 404
      });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("unsupported_model");
    });

    it("classifies cancellation / AbortError as cancelled (non-fallback, non-retryable)", () => {
      const err = new Error("Request aborted");
      err.name = "AbortError";
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("cancelled");
    });

    it("classifies 403 Forbidden / PermissionDenied as permission_denied", () => {
      const err = Object.assign(new Error("Permission denied to model resource"), {
        status: 403
      });
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("permission_denied");
    });

    it("classifies unknown generic errors as internal_error", () => {
      const err = new Error("Unexpected parsing token failure");
      const result = classifyProviderError(err);

      expect(result.isFallbackEligible).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe("internal_error");
    });
  });
});
