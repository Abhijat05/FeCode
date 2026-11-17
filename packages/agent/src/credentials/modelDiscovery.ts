import { sanitizeReason, sanitizeApiKey, sanitizeBaseUrl } from "@fecode/models";

export interface DiscoveredModel {
  id: string;
  displayName: string;
  description?: string;
  isRecommended?: boolean;
}

export interface DiscoverModelsOptions {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DiscoverModelsResult {
  success: boolean;
  models: DiscoveredModel[];
  error?: string;
}

/**
 * Strips any occurrence of the actual provided apiKey from error messages
 * in addition to generic API key patterns.
 */
export function scrubSensitiveKey(text: string, apiKey?: string): string {
  let cleaned = sanitizeReason(text);
  if (apiKey && apiKey.length >= 4) {
    const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "g"), "[REDACTED_API_KEY]");
  }
  return cleaned;
}

/**
 * Returns curated fallback default models for each supported provider.
 */
export function getCuratedDefaultModels(providerId: string): DiscoveredModel[] {
  const normalized = providerId.toLowerCase().trim();
  switch (normalized) {
    case "gemini":
      return [
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", isRecommended: true },
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
        { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro" },
        { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash" }
      ];
    case "openai":
      return [
        { id: "gpt-4o", displayName: "GPT-4o", isRecommended: true },
        { id: "gpt-4o-mini", displayName: "GPT-4o Mini" },
        { id: "o3-mini", displayName: "o3-mini" },
        { id: "o1", displayName: "o1" }
      ];
    case "ollama":
      return [
        { id: "qwen2.5-coder", displayName: "Qwen 2.5 Coder", isRecommended: true }
      ];
    case "openai-compatible":
      return [
        { id: "deepseek-ai/deepseek-v4.1-flash", displayName: "DeepSeek v4.1 Flash", isRecommended: true }
      ];
    case "anthropic":
      return [
        { id: "claude-3-5-sonnet-latest", displayName: "Claude 3.5 Sonnet", isRecommended: true },
        { id: "claude-3-5-haiku-latest", displayName: "Claude 3.5 Haiku" },
        { id: "claude-3-opus-latest", displayName: "Claude 3 Opus" }
      ];
    default:
      return [];
  }
}

interface RawDiscoveredModelItem {
  id?: string;
  name?: string;
  displayName?: string;
  display_name?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  supportedActions?: string[];
  [key: string]: unknown;
}

/**
 * Helper to collect items from array, page, data, or async/sync iterables.
 */
async function extractRawList(response: unknown): Promise<RawDiscoveredModelItem[]> {
  const items: RawDiscoveredModelItem[] = [];
  if (Array.isArray(response)) {
    for (const item of response) {
      if (item && typeof item === "object") {
        items.push(item as RawDiscoveredModelItem);
      }
    }
  } else if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      for (const item of obj.data) {
        if (item && typeof item === "object") {
          items.push(item as RawDiscoveredModelItem);
        }
      }
    } else if (Array.isArray(obj.page)) {
      for (const item of obj.page) {
        if (item && typeof item === "object") {
          items.push(item as RawDiscoveredModelItem);
        }
      }
    } else if (Array.isArray(obj.models)) {
      for (const item of obj.models) {
        if (item && typeof item === "object") {
          items.push(item as RawDiscoveredModelItem);
        }
      }
    } else if (typeof obj[Symbol.asyncIterator as unknown as string] === "function" || Symbol.asyncIterator in obj) {
      for await (const item of (obj as unknown as AsyncIterable<unknown>)) {
        if (item && typeof item === "object") {
          items.push(item as RawDiscoveredModelItem);
        }
      }
    } else if (typeof obj[Symbol.iterator as unknown as string] === "function" || Symbol.iterator in obj) {
      for (const item of (obj as unknown as Iterable<unknown>)) {
        if (item && typeof item === "object") {
          items.push(item as RawDiscoveredModelItem);
        }
      }
    }
  }
  return items;
}

/**
 * Orders models placing pinned model IDs first in the specified order,
 * with optional recommended model flag.
 */
function orderWithPinned(
  models: DiscoveredModel[],
  pinnedIds: string[],
  recommendedId?: string
): DiscoveredModel[] {
  const pinned: DiscoveredModel[] = [];
  const remaining: DiscoveredModel[] = [];

  const map = new Map<string, DiscoveredModel>();
  for (const m of models) {
    map.set(m.id, m);
  }

  for (const pid of pinnedIds) {
    const found = map.get(pid);
    if (found) {
      pinned.push(found);
      map.delete(pid);
    }
  }

  for (const m of models) {
    if (map.has(m.id)) {
      remaining.push(m);
    }
  }

  const combined = [...pinned, ...remaining];
  const targetRecId = recommendedId ?? pinned[0]?.id ?? combined[0]?.id;

  return combined.map((m) => {
    if (m.id === targetRecId) {
      return { ...m, isRecommended: true };
    }
    const copy = { ...m };
    delete copy.isRecommended;
    return copy;
  });
}

/**
 * Discovers available models for a given AI provider with resilient fallback,
 * timeout controls, and credential scrubbing.
 */
export async function discoverAvailableModels(
  options: DiscoverModelsOptions
): Promise<DiscoverModelsResult> {
  const providerId = options.providerId.toLowerCase().trim();
  const apiKey = sanitizeApiKey(options.apiKey);
  const baseUrl = sanitizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 3000;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error(`Model discovery timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const userSignal = options.signal;
  if (userSignal?.aborted) {
    clearTimeout(timeoutId);
    return {
      success: false,
      models: getCuratedDefaultModels(providerId),
      error: "Model discovery cancelled by user."
    };
  }

  const onUserAbort = () => {
    timeoutController.abort(new Error("Model discovery cancelled by user."));
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
        const modelsApi = client.models as unknown as {
          list?: (params?: unknown, options?: unknown) => Promise<unknown>;
        };

        if (typeof modelsApi?.list !== "function") {
          throw new Error("Google Gemini models.list is not a function.");
        }

        const response = await modelsApi.list({ signal, config: { abortSignal: signal } });
        const rawItems = await extractRawList(response);

        const filtered: DiscoveredModel[] = [];
        for (const item of rawItems) {
          const rawId = String(item.name || item.id || "");
          const id = rawId.startsWith("models/") ? rawId.slice(7) : rawId;
          const lowerId = id.toLowerCase();

          // Check supported generation methods if present
          const methods: string[] | undefined = item.supportedGenerationMethods || item.supportedActions;
          if (Array.isArray(methods) && !methods.includes("generateContent")) {
            continue;
          }

          // Exclude embeddings and Imagen
          if (lowerId.includes("text-embedding-") || lowerId.includes("imagen-")) {
            continue;
          }

          filtered.push({
            id,
            displayName: item.displayName || id,
            description: item.description
          });
        }

        const pinnedOrder = [
          "gemini-2.5-flash",
          "gemini-2.5-pro",
          "gemini-1.5-pro",
          "gemini-1.5-flash"
        ];
        const ordered = orderWithPinned(filtered, pinnedOrder, "gemini-2.5-flash");

        return {
          success: true,
          models: ordered
        };
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

        const response = await client.models.list({ signal });
        const rawItems = await extractRawList(response);

        const filtered: DiscoveredModel[] = [];
        for (const item of rawItems) {
          const id = String(item.id || "");
          const lowerId = id.toLowerCase();

          // Exclude embeddings, audio, image, moderation, legacy completions
          if (
            lowerId.includes("text-embedding-") ||
            lowerId.includes("embedding") ||
            lowerId.startsWith("whisper-") ||
            lowerId.startsWith("tts-") ||
            lowerId.startsWith("dall-e-") ||
            lowerId.includes("moderation") ||
            lowerId.startsWith("davinci-") ||
            lowerId.startsWith("babbage-") ||
            lowerId === "davinci" ||
            lowerId === "babbage"
          ) {
            continue;
          }

          // Include gpt-4*, o1*, o3*, and chatgpt-*
          if (!/^(gpt-4|o1|o3|chatgpt-)/i.test(id)) {
            continue;
          }

          filtered.push({
            id,
            displayName: item.displayName || item.name || id,
            description: item.description
          });
        }

        const pinnedOrder = ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"];
        const ordered = orderWithPinned(filtered, pinnedOrder, "gpt-4o");

        return {
          success: true,
          models: ordered
        };
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

        const response = await client.models.list({ signal });
        const rawItems = await extractRawList(response);

        const coderModels: DiscoveredModel[] = [];
        const otherModels: DiscoveredModel[] = [];

        for (const item of rawItems) {
          const id = String(item.id || "");
          const model: DiscoveredModel = {
            id,
            displayName: item.displayName || item.name || id,
            description: item.description
          };
          if (/coder|code/i.test(id)) {
            coderModels.push(model);
          } else {
            otherModels.push(model);
          }
        }

        const ordered = [...coderModels, ...otherModels];
        if (ordered.length > 0) {
          ordered[0] = { ...ordered[0], isRecommended: true };
        }

        return {
          success: true,
          models: ordered
        };
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

        const response = await client.models.list({ signal });
        const rawItems = await extractRawList(response);

        const filtered: DiscoveredModel[] = [];
        for (const item of rawItems) {
          const id = String(item.id || "");
          if (id.toLowerCase().includes("embedding")) {
            continue;
          }
          filtered.push({
            id,
            displayName: item.displayName || item.name || id,
            description: item.description
          });
        }

        const defaultModelId = "deepseek-ai/deepseek-v4.1-flash";
        const hasDefault = filtered.some((m) => m.id === defaultModelId);
        const pinnedOrder = hasDefault ? [defaultModelId] : [];
        const ordered = orderWithPinned(filtered, pinnedOrder, hasDefault ? defaultModelId : undefined);

        return {
          success: true,
          models: ordered
        };
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

        const curatedAnthropic = getCuratedDefaultModels("anthropic");

        let response: unknown;
        try {
          const modelsApi = client.models as unknown as {
            list?: (params?: unknown, options?: unknown) => Promise<unknown>;
          };
          if (typeof modelsApi?.list === "function") {
            response = await modelsApi.list({ signal }, { signal });
          } else {
            throw new Error("Anthropic client.models.list is not a function");
          }
        } catch (listErr: unknown) {
          const msg = listErr instanceof Error ? listErr.message : String(listErr);
          const status = (listErr as { status?: number; statusCode?: number })?.status ??
            (listErr as { status?: number; statusCode?: number })?.statusCode;

          const isAuthOrNetwork =
            status === 401 ||
            status === 403 ||
            msg.includes("unauthorized") ||
            msg.includes("invalid api key") ||
            msg.includes("api_key_invalid") ||
            msg.includes("ECONNREFUSED") ||
            msg.includes("fetch failed") ||
            msg.includes("timed out") ||
            msg.includes("timeout") ||
            msg.includes("cancelled");

          if (isAuthOrNetwork) {
            throw listErr;
          }

          // Fallback to curated Claude models when models.list is not supported
          return {
            success: true,
            models: curatedAnthropic
          };
        }

        const rawItems = await extractRawList(response);
        const filtered: DiscoveredModel[] = [];
        for (const item of rawItems) {
          const id = String(item.id || "");
          if (id.toLowerCase().includes("embedding")) {
            continue;
          }
          filtered.push({
            id,
            displayName: item.display_name || item.displayName || item.name || id,
            description: item.description
          });
        }

        // Pin Sonnet models to top with recommendation
        const sonnetId = filtered.find((m) => /3-5-sonnet/i.test(m.id))?.id || "claude-3-5-sonnet-latest";
        const pinnedOrder = [
          sonnetId,
          "claude-3-5-sonnet-latest",
          "claude-3-5-haiku-latest",
          "claude-3-opus-latest"
        ];
        const ordered = orderWithPinned(filtered, pinnedOrder, sonnetId);

        return {
          success: true,
          models: ordered
        };
      }

      default:
        throw new Error(`Unsupported provider ID for model discovery: "${providerId}"`);
    }
  } catch (err: unknown) {
    const rawReason = err instanceof Error ? err.message : String(err);
    const sanitizedReason = scrubSensitiveKey(rawReason, apiKey);

    return {
      success: false,
      models: getCuratedDefaultModels(providerId),
      error: userSignal?.aborted || rawReason.includes("cancelled")
        ? "Model discovery cancelled by user."
        : sanitizedReason
    };
  } finally {
    clearTimeout(timeoutId);
    if (userSignal) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
  }
}
