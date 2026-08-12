import { OpenAIModelProvider } from "./providers/openai/index.js";
import { GeminiModelProvider } from "./providers/gemini/index.js";
import { OllamaModelProvider } from "./providers/ollama/index.js";
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
