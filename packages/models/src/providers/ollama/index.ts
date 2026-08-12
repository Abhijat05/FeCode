import OpenAI from "openai";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest
} from "../../types.js";
import { OpenAIModelProvider } from "../openai/index.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  client?: OpenAI;
}

export class OllamaModelProvider implements ModelProvider {
  public readonly id = "ollama";
  public readonly baseUrl: string;
  public readonly model: string;
  private readonly delegate: OpenAIModelProvider;

  public readonly capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 32768
  };

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      "http://localhost:11434/v1";
    this.model = options.model || process.env.FE_MODEL || "qwen2.5-coder";

    const client =
      options.client ||
      new OpenAI({
        baseURL: this.baseUrl,
        apiKey: "ollama"
      });

    this.delegate = new OpenAIModelProvider({
      apiKey: "ollama",
      model: this.model,
      client
    });
  }

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    try {
      for await (const event of this.delegate.generate(request, signal)) {
        if (event.type === "error") {
          yield {
            type: "error",
            error: this.formatOllamaError(event.error)
          };
        } else {
          yield event;
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield {
        type: "error",
        error: this.formatOllamaError(error)
      };
    }
  }

  private formatOllamaError(error: Error): Error {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("econnrefused") ||
      msg.includes("fetch failed") ||
      msg.includes("404") ||
      msg.includes("not found")
    ) {
      return new Error(
        `Ollama server or model unavailable at ${this.baseUrl}. Ensure Ollama is running and the model is installed (e.g. 'ollama pull ${this.model}'). Original error: ${error.message}`
      );
    }
    return error;
  }
}
