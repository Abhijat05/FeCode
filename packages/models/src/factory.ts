import { OpenAIModelProvider } from "./providers/openai/index.js";
import { GeminiModelProvider } from "./providers/gemini/index.js";
import { OllamaModelProvider } from "./providers/ollama/index.js";
import { FallbackModelProvider, type FallbackEvent, type FallbackCandidate } from "./fallback/fallbackProvider.js";
import type { ModelProvider } from "./types.js";

export interface ModelConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function createModelProvider(config: ModelConfig): ModelProvider {
  const providerName = config.provider.toLowerCase().trim();

  switch (providerName) {
    case "openai":
      return new OpenAIModelProvider({
        apiKey: config.apiKey,
        model: config.model
      });
    case "gemini":
      return new GeminiModelProvider({
        apiKey: config.apiKey,
        model: config.model
      });
    case "ollama":
      return new OllamaModelProvider({
        baseUrl: config.baseUrl,
        model: config.model
      });
    default:
      throw new Error(`Unsupported model provider: ${config.provider}`);
  }
}

export interface FallbackConfigOptions {
  primaryProvider: string;
  primaryModel?: string;
  fallbackProviders?: string[];
  geminiApiKey?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  maxRetriesPerProvider?: number;
  maxTotalFallbackSwitches?: number;
  onFallback?: (event: FallbackEvent) => void;
  onProviderAttempt?: (providerId: string, attempt: number) => void;
}

export function createConfiguredFallbackChain(
  options: FallbackConfigOptions
): FallbackModelProvider {
  const primaryName = options.primaryProvider.toLowerCase().trim();
  const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
  const openaiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  const ollamaUrl = options.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";

  const candidates: FallbackCandidate[] = [];
  const addedProviders = new Set<string>();

  // 1. Add primary provider
  const primaryProvider = createModelProvider({
    provider: primaryName,
    model: options.primaryModel,
    apiKey: primaryName === "gemini" ? geminiKey : primaryName === "openai" ? openaiKey : undefined,
    baseUrl: primaryName === "ollama" ? ollamaUrl : undefined
  });
  candidates.push({
    provider: primaryProvider,
    maxRetries: options.maxRetriesPerProvider ?? 1
  });
  addedProviders.add(primaryName);

  // 2. Determine ordered list of potential fallback provider names
  const candidateNames = options.fallbackProviders && options.fallbackProviders.length > 0
    ? options.fallbackProviders.map((p) => p.toLowerCase().trim())
    : ["gemini", "openai", "ollama"];

  for (const name of candidateNames) {
    if (addedProviders.has(name)) {
      continue;
    }

    if (name === "gemini") {
      if (geminiKey) {
        candidates.push({
          provider: new GeminiModelProvider({
            apiKey: geminiKey,
            model: "gemini-2.5-flash"
          }),
          maxRetries: options.maxRetriesPerProvider ?? 1
        });
        addedProviders.add(name);
      }
    } else if (name === "openai") {
      if (openaiKey) {
        candidates.push({
          provider: new OpenAIModelProvider({
            apiKey: openaiKey,
            model: "gpt-4o"
          }),
          maxRetries: options.maxRetriesPerProvider ?? 1
        });
        addedProviders.add(name);
      }
    } else if (name === "ollama") {
      candidates.push({
        provider: new OllamaModelProvider({
          baseUrl: ollamaUrl,
          model: "qwen2.5-coder"
        }),
        maxRetries: options.maxRetriesPerProvider ?? 1
      });
      addedProviders.add(name);
    }
  }

  return new FallbackModelProvider({
    candidates,
    maxTotalFallbackSwitches: options.maxTotalFallbackSwitches,
    onFallback: options.onFallback,
    onProviderAttempt: options.onProviderAttempt
  });
}
