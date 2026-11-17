import { classifyProviderError, sanitizeReason, sanitizeApiKey, sanitizeBaseUrl } from "@fecode/models";
import type { ConnectionTestResult } from "./types.js";

export interface TestConnectionOptions {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Strips any occurrence of the actual provided apiKey from error messages
 * in addition to generic patterns.
 */
function scrubSensitiveKey(text: string, apiKey?: string): string {
  let cleaned = sanitizeReason(text);
  if (apiKey && apiKey.length >= 4) {
    const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "g"), "[REDACTED_API_KEY]");
  }
  return cleaned;
}

export async function testProviderConnection(
  options: TestConnectionOptions
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const providerId = options.providerId.toLowerCase().trim();
  const model = options.model.trim();
  const apiKey = sanitizeApiKey(options.apiKey);
  const baseUrl = sanitizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 3000;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error(`Connection test timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const userSignal = options.signal;
  if (userSignal?.aborted) {
    clearTimeout(timeoutId);
    return {
      success: false,
      providerId,
      model,
      steps: { authentication: "failed", modelAvailable: "skipped" },
      durationMs: 0,
      message: "Connection test cancelled by user.",
      error: {
        category: "cancelled",
        reason: "Connection test cancelled by user."
      }
    };
  }

  const onUserAbort = () => {
    timeoutController.abort(new Error("Connection test cancelled by user."));
  };
  if (userSignal) {
    userSignal.addEventListener("abort", onUserAbort, { once: true });
  }

  const signal = timeoutController.signal;

  try {
    switch (providerId) {
      case "gemini": {
        if (!apiKey) {
          throw new Error("Google Gemini requires an API key.");
        }
        const { GoogleGenAI } = await import("@google/genai");
        const client = new GoogleGenAI({ apiKey });
        // Minimal authentication & model validation
        // Use countTokens or get model to avoid generating expensive tokens
        const modelsApi = client.models as unknown as {
          get?: (params: { model: string }, options?: { signal?: AbortSignal }) => Promise<unknown>;
          countTokens?: (params: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
        };

        try {
          if (typeof modelsApi.get === "function") {
            await modelsApi.get({ model }, { signal });
          } else {
            throw new Error("models.get is not a function");
          }
        } catch (err: unknown) {
          // If models.get is not implemented or fails, attempt a 1-character countTokens ping
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("not found") || msg.includes("is not a function")) {
            if (typeof modelsApi.countTokens === "function") {
              await modelsApi.countTokens(
                {
                  model,
                  contents: [{ role: "user", parts: [{ text: "ping" }] }]
                },
                { signal }
              );
            }
          } else {
            throw err;
          }
        }
        break;
      }

      case "openai": {
        if (!apiKey) {
          throw new Error("OpenAI requires an API key.");
        }
        const OpenAIModule = await import("openai");
        const OpenAI = OpenAIModule.default || OpenAIModule;
        const client = new OpenAI({
          apiKey,
          baseURL: baseUrl || undefined,
          maxRetries: 0,
          timeout: timeoutMs
        });

        // Test authentication and model availability
        try {
          await client.models.retrieve(model, { signal });
        } catch (err: unknown) {
          // Some models or proxies might not support single-model retrieve; try listing
          const status = (err as { status?: number })?.status;
          if (status === 404 || status === 400) {
            await client.models.list({ signal });
          } else {
            throw err;
          }
        }
        break;
      }

      case "ollama": {
        const resolvedBaseUrl = baseUrl || "http://localhost:11434/v1";
        const OpenAIModule = await import("openai");
        const OpenAI = OpenAIModule.default || OpenAIModule;
        const client = new OpenAI({
          baseURL: resolvedBaseUrl,
          apiKey: apiKey || "ollama",
          maxRetries: 0,
          timeout: timeoutMs
        });

        await client.models.list({ signal });
        break;
      }

      case "openai-compatible": {
        if (!baseUrl) {
          throw new Error("OpenAI-compatible provider requires a base URL.");
        }
        const OpenAIModule = await import("openai");
        const OpenAI = OpenAIModule.default || OpenAIModule;
        const client = new OpenAI({
          baseURL: baseUrl,
          apiKey: apiKey || "dummy-key",
          maxRetries: 0,
          timeout: timeoutMs
        });

        try {
          await client.models.retrieve(model, { signal });
        } catch {
          // Many custom/compatible endpoints (like vLLM, NIM) only support models.list()
          await client.models.list({ signal });
        }
        break;
      }

      case "anthropic": {
        if (!apiKey) {
          throw new Error("Anthropic requires an API key.");
        }
        const AnthropicModule = await import("@anthropic-ai/sdk");
        const Anthropic = AnthropicModule.default || AnthropicModule;
        const client = new Anthropic({
          apiKey,
          baseURL: baseUrl || undefined,
          maxRetries: 0,
          timeout: timeoutMs
        });
        // Count tokens or minimal ping
        const anthropicClient = client as unknown as {
          messages: {
            countTokens(
              params: { model: string; messages: Array<{ role: string; content: string }> },
              options?: { signal?: AbortSignal }
            ): Promise<unknown>;
          };
        };
        await anthropicClient.messages.countTokens(
          {
            model: model || "claude-sonnet-5-5",
            messages: [{ role: "user", content: "ping" }]
          },
          { signal }
        );
        break;
      }

      default:
        throw new Error(`Unsupported provider ID for connection test: "${providerId}"`);
    }

    return {
      success: true,
      providerId,
      model,
      steps: {
        authentication: "success",
        modelAvailable: "success"
      },
      durationMs: Date.now() - startTime,
      message: "Provider is ready."
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const classification = classifyProviderError(err);
    const errObj = err as Record<string, unknown> | undefined;
    const causeObj = errObj?.cause as Record<string, unknown> | undefined;
    const causeMessage = typeof causeObj?.message === "string" ? causeObj.message : "";
    const rawReason = err instanceof Error ? err.message : String(err);
    const combinedReason = causeMessage && !rawReason.includes(causeMessage)
      ? `${rawReason} (${causeMessage})`
      : rawReason;
    const sanitizedReason = scrubSensitiveKey(combinedReason, apiKey);

    let authStep: "success" | "failed" | "skipped" = "failed";
    let modelStep: "success" | "failed" | "skipped" = "skipped";

    if (classification.category === "unsupported_model") {
      authStep = "success";
      modelStep = "failed";
    }

    let displayMessage: string;
    if (classification.category === "authentication") {
      if (
        sanitizedReason.includes("invalid") &&
        (sanitizedReason.includes("header") || sanitizedReason.includes("bytestring") || sanitizedReason.includes("key"))
      ) {
        displayMessage = "Authentication failed: The provided API key contains invalid characters or formatting. Check your API key and try again.";
      } else {
        displayMessage = "Authentication failed. Check your API key and try again.";
      }
    } else if (classification.category === "unsupported_model") {
      displayMessage = `Model "${model}" was not found or is unsupported by this provider.`;
    } else if (
      classification.category === "transient_network" ||
      sanitizedReason.includes("fetch failed") ||
      sanitizedReason.includes("ECONNREFUSED") ||
      sanitizedReason.includes("ENOTFOUND")
    ) {
      if (
        sanitizedReason.includes("ECONNREFUSED") ||
        (baseUrl && (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")))
      ) {
        displayMessage = `Connection refused (${sanitizedReason}). Ensure your local provider endpoint is running and reachable.`;
      } else {
        displayMessage = `Network connection failed (${sanitizedReason}). Check your internet connection, endpoint URL, or proxy.`;
      }
    } else {
      displayMessage = sanitizedReason;
    }

    return {
      success: false,
      providerId,
      model,
      steps: {
        authentication: authStep,
        modelAvailable: modelStep
      },
      durationMs,
      message: displayMessage,
      error: {
        category: userSignal?.aborted || rawReason.includes("cancelled")
          ? "cancelled"
          : rawReason.includes("timed out")
            ? "network_error"
            : classification.category,
        reason: sanitizedReason,
        statusCode: classification.statusCode
      }
    };
  } finally {
    clearTimeout(timeoutId);
    if (userSignal) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
  }
}
