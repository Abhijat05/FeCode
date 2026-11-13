import { classifyProviderError, sanitizeReason } from "@fecode/models";
import type { ConnectionTestResult } from "./types.js";

export interface TestConnectionOptions {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
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
  const apiKey = options.apiKey?.trim();
  const baseUrl = options.baseUrl?.trim();
  const signal = options.signal;

  try {
    if (signal?.aborted) {
      throw new Error("Connection test cancelled by user.");
    }

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
          maxRetries: 0
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
          maxRetries: 0
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
          maxRetries: 0
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
          maxRetries: 0
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
    const rawReason = err instanceof Error ? err.message : String(err);
    const sanitizedReason = scrubSensitiveKey(rawReason, apiKey);

    let authStep: "success" | "failed" | "skipped" = "failed";
    let modelStep: "success" | "failed" | "skipped" = "skipped";

    if (classification.category === "unsupported_model") {
      authStep = "success";
      modelStep = "failed";
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
      message: classification.category === "authentication"
        ? "Authentication failed. Check your API key and try again."
        : classification.category === "unsupported_model"
          ? `Model "${model}" was not found or is unsupported by this provider.`
          : sanitizedReason,
      error: {
        category: classification.category,
        reason: sanitizedReason,
        statusCode: classification.statusCode
      }
    };
  }
}
