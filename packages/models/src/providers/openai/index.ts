import OpenAI from "openai";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  TokenUsage
} from "../../types.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

export class OpenAIModelProvider implements ModelProvider {
  public readonly id = "openai";
  public readonly model: string;
  private readonly apiKey: string;
  private readonly client: OpenAI;

  public readonly capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 128000
  };

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }
    this.apiKey = apiKey;
    this.model = options.model || process.env.FE_MODEL || "gpt-4o";
    this.client =
      options.client ||
      new OpenAI({
        apiKey: this.apiKey
      });
  }

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    try {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }

      const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      if (request.system) {
        openAiMessages.push({
          role: "system",
          content: request.system
        });
      }

      for (const msg of request.messages) {
        openAiMessages.push({
          role: msg.role,
          content: msg.content
        });
      }

      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: openAiMessages,
          stream: true,
          stream_options: {
            include_usage: true
          }
        },
        { signal }
      );

      let usage: TokenUsage | undefined;

      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }

        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield { type: "text_delta", content: delta };
        }

        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens
          };
        }
      }

      yield { type: "completed", usage };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: "error", error };
    }
  }
}
