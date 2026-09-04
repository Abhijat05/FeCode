import OpenAI from "openai";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  TokenUsage
} from "../../types.js";
import type { ToolCall } from "../../tools/types.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
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
        if (msg.role === "system") {
          openAiMessages.push({
            role: "system",
            content: msg.content || ""
          });
        } else if (msg.role === "user") {
          openAiMessages.push({
            role: "user",
            content: msg.content || ""
          });
        } else if (msg.role === "assistant") {
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            openAiMessages.push({
              role: "assistant",
              content: msg.content || null,
              tool_calls: msg.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments:
                    typeof tc.arguments === "string"
                      ? tc.arguments
                      : JSON.stringify(tc.arguments || {})
                }
              }))
            });
          } else {
            openAiMessages.push({
              role: "assistant",
              content: msg.content || ""
            });
          }
        } else if (msg.role === "tool") {
          openAiMessages.push({
            role: "tool",
            tool_call_id: msg.toolCallId || "",
            content: msg.content || ""
          });
        }
      }

      const openAiTools = request.tools?.length
        ? request.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: (t.inputSchema as Record<string, unknown>) || {
                type: "object",
                properties: {}
              }
            }
          }))
        : undefined;

      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: openAiMessages,
          tools: openAiTools,
          stream: true,
          stream_options: {
            include_usage: true
          }
        },
        { signal }
      );

      let usage: TokenUsage | undefined;
      const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();

      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }

        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: "text_delta", content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const index = tcDelta.index;
            const existing = accumulatedToolCalls.get(index) || {
              id: "",
              name: "",
              arguments: ""
            };

            if (tcDelta.id) existing.id += tcDelta.id;
            if (tcDelta.function?.name) existing.name += tcDelta.function.name;
            if (tcDelta.function?.arguments) {
              existing.arguments += tcDelta.function.arguments;
            }

            accumulatedToolCalls.set(index, existing);
          }
        }

        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens
          };
        }
      }

      for (const [, callData] of accumulatedToolCalls) {
        let parsedArgs: unknown = {};
        if (callData.arguments && callData.arguments.trim()) {
          try {
            parsedArgs = JSON.parse(callData.arguments);
          } catch {
            parsedArgs = callData.arguments;
          }
        }

        const call: ToolCall = {
          id: callData.id,
          name: callData.name,
          arguments: parsedArgs
        };

        yield { type: "tool_call", call };
      }

      yield { type: "completed", usage };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      let message = error.message;
      if (
        message.includes("401 Unauthorized") ||
        message.toLowerCase().includes("incorrect api key")
      ) {
        message = `OpenAI API key is invalid or unauthorized. Please check your OPENAI_API_KEY environment variable. Original error: ${error.message}`;
      } else if (
        message.includes("429 Too Many Requests") ||
        message.toLowerCase().includes("rate limit reached (429")
      ) {
        message = `OpenAI quota exceeded or rate limit reached (429 RateLimit). Please wait a moment before retrying.`;
      }
      yield { type: "error", error: new Error(message) };
    }
  }
}
