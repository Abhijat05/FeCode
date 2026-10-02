import OpenAI from "openai";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  TokenUsage
} from "../../types.js";
import type { ToolCall } from "../../tools/types.js";
import { sanitizeReason } from "../../errors/classification.js";

export interface OpenAICompatibleProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  extraBody?: Record<string, unknown>;
  maxContextTokens?: number;
  timeoutMs?: number;
  streamIdleTimeoutMs?: number;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  public readonly id = "openai-compatible";
  public readonly baseUrl: string;
  public readonly model: string;
  public readonly timeoutMs: number;
  public readonly streamIdleTimeoutMs: number;
  private readonly apiKey: string;
  private readonly client: OpenAI;
  private readonly extraBody?: Record<string, unknown>;

  public readonly capabilities: ModelCapabilities;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    const rawBaseUrl =
      options.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      process.env.FE_OPENAI_BASE_URL;

    if (!rawBaseUrl || !rawBaseUrl.trim()) {
      throw new Error(
        "OpenAI-compatible provider requires a base URL. Please set OPENAI_BASE_URL."
      );
    }

    try {
      const parsedUrl = new URL(rawBaseUrl.trim());
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(
          `OpenAI-compatible provider received an invalid base URL: "${rawBaseUrl}". It must be an HTTP or HTTPS URL.`
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("It must be an HTTP")) {
        throw err;
      }
      throw new Error(
        `OpenAI-compatible provider received an invalid base URL: "${rawBaseUrl}".`
      );
    }
    this.baseUrl = rawBaseUrl.trim();

    const apiKey =
      options.apiKey ||
      process.env.OPENAI_COMPATIBLE_API_KEY ||
      process.env.FE_OPENAI_COMPATIBLE_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.FE_OPENAI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        "OpenAI-compatible provider requires an API key. Please set OPENAI_API_KEY."
      );
    }
    this.apiKey = apiKey.trim();

    const model = options.model || process.env.FE_MODEL;
    if (!model || !model.trim()) {
      throw new Error(
        "OpenAI-compatible provider requires a model identifier. Please set FE_MODEL."
      );
    }
    this.model = model.trim();

    this.extraBody = options.extraBody;

    const envTimeout = process.env.FE_REQUEST_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS;
    let parsedEnvTimeout: number | undefined;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        parsedEnvTimeout = parsed;
      }
    }
    this.timeoutMs =
      typeof options.timeoutMs === "number" && options.timeoutMs >= 0
        ? options.timeoutMs
        : (parsedEnvTimeout ?? 60000);

    const envIdleTimeout = process.env.FE_STREAM_IDLE_TIMEOUT_MS;
    let parsedEnvIdleTimeout: number | undefined;
    if (envIdleTimeout) {
      const parsed = parseInt(envIdleTimeout, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        parsedEnvIdleTimeout = parsed;
      }
    }
    this.streamIdleTimeoutMs =
      typeof options.streamIdleTimeoutMs === "number" && options.streamIdleTimeoutMs >= 0
        ? options.streamIdleTimeoutMs
        : (parsedEnvIdleTimeout ?? 45000);

    const maxContextTokens =
      typeof options.maxContextTokens === "number" && options.maxContextTokens > 0
        ? options.maxContextTokens
        : 128000;

    this.capabilities = {
      streaming: true,
      toolCalling: true,
      vision: true,
      maxContextTokens
    };

    this.client =
      options.client ||
      new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
        timeout: this.timeoutMs > 0 ? this.timeoutMs : undefined
      });
  }

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    const timeoutController = new AbortController();
    let timeoutError: Error | null = null;
    let requestTimer: NodeJS.Timeout | null = null;
    let streamIdleTimer: NodeJS.Timeout | null = null;

    const onCallerAbort = () => {
      timeoutController.abort(signal?.reason || new Error("Request aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
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

      if (this.timeoutMs > 0) {
        requestTimer = setTimeout(() => {
          timeoutError = new Error(
            `OpenAI-compatible request timed out after ${this.timeoutMs}ms (model: "${this.model}", baseUrl: "${this.baseUrl}").`
          );
          timeoutController.abort(timeoutError);
        }, this.timeoutMs);
      }

      let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      try {
        stream = (await this.client.chat.completions.create(
          {
            model: this.model,
            messages: openAiMessages,
            tools: openAiTools,
            stream: true,
            stream_options: {
              include_usage: true
            },
            ...(this.extraBody || {})
          } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          {
            signal: timeoutController.signal,
            timeout: this.timeoutMs > 0 ? this.timeoutMs : undefined
          }
        )) as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      } catch (err: unknown) {
        if (timeoutError) {
          throw timeoutError;
        }
        throw err;
      } finally {
        if (requestTimer) {
          clearTimeout(requestTimer);
          requestTimer = null;
        }
      }

      let usage: TokenUsage | undefined;
      let isThinking = false;
      const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();

      const resetStreamIdleTimer = () => {
        if (streamIdleTimer) {
          clearTimeout(streamIdleTimer);
          streamIdleTimer = null;
        }
        if (this.streamIdleTimeoutMs > 0) {
          streamIdleTimer = setTimeout(() => {
            timeoutError = new Error(
              `OpenAI-compatible stream stalled: no data received for ${this.streamIdleTimeoutMs}ms (model: "${this.model}").`
            );
            timeoutController.abort(timeoutError);
          }, this.streamIdleTimeoutMs);
        }
      };

      resetStreamIdleTimer();

      try {
        for await (const chunk of stream) {
          resetStreamIdleTimer();

          if (signal?.aborted) {
            throw new Error("Request aborted");
          }

          const delta = chunk.choices[0]?.delta;
          const deltaAny = delta as
            | (typeof delta & {
                reasoning?: string;
                reasoning_content?: string;
              })
            | undefined;
          const reasoningChunk =
            deltaAny?.reasoning || deltaAny?.reasoning_content;

          if (reasoningChunk) {
            if (!isThinking) {
              isThinking = true;
              yield { type: "text_delta", content: "<think>" };
            }
            yield { type: "text_delta", content: reasoningChunk };
          }

          if (delta?.content) {
            if (isThinking) {
              isThinking = false;
              yield { type: "text_delta", content: "</think>" };
            }
            yield { type: "text_delta", content: delta.content };
          }

          if (delta?.tool_calls) {
            if (isThinking) {
              isThinking = false;
              yield { type: "text_delta", content: "</think>" };
            }
            for (const tcDelta of delta.tool_calls) {
              const index = typeof tcDelta.index === "number" ? tcDelta.index : 0;
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
      } catch (err: unknown) {
        if (timeoutError) {
          throw timeoutError;
        }
        throw err;
      } finally {
        if (streamIdleTimer) {
          clearTimeout(streamIdleTimer);
          streamIdleTimer = null;
        }
      }

      if (isThinking) {
        isThinking = false;
        yield { type: "text_delta", content: "</think>" };
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
          id:
            callData.id ||
            `call_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          name: callData.name,
          arguments: parsedArgs
        };

        yield { type: "tool_call", call };
      }

      yield { type: "completed", usage };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      let sanitized = sanitizeReason(error.message);
      if (this.apiKey) {
        sanitized = sanitized.split(this.apiKey).join("[REDACTED_API_KEY]");
      }
      let message = sanitized;

      if (timeoutError) {
        message = (timeoutError as Error).message;
      } else if (
        sanitized.toLowerCase().includes("timed out") ||
        sanitized.toLowerCase().includes("timeout") ||
        sanitized.toLowerCase().includes("stream stalled") ||
        error.name === "TimeoutError" ||
        error.name === "APIConnectionTimeoutError"
      ) {
        message = sanitized;
      } else if (
        sanitized.includes("401") ||
        sanitized.toLowerCase().includes("unauthorized") ||
        sanitized.toLowerCase().includes("invalid api key") ||
        sanitized.toLowerCase().includes("incorrect api key")
      ) {
        message = `OpenAI-compatible provider authentication failed (401 Unauthorized). Please check your OPENAI_API_KEY. Endpoint: ${this.baseUrl}. Original error: ${sanitized}`;
      } else if (
        sanitized.includes("404") ||
        sanitized.toLowerCase().includes("model not found") ||
        sanitized.toLowerCase().includes("does not exist") ||
        sanitized.toLowerCase().includes("unknown model")
      ) {
        message = `Model '${this.model}' was rejected by the configured endpoint (${this.baseUrl}) (404 Not Found). Original error: ${sanitized}`;
      } else if (
        sanitized.includes("429") ||
        sanitized.toLowerCase().includes("too many requests") ||
        sanitized.toLowerCase().includes("rate limit") ||
        sanitized.toLowerCase().includes("quota")
      ) {
        message = `OpenAI-compatible provider quota exceeded or rate limit reached (429 RateLimit). Endpoint: ${this.baseUrl}. Original error: ${sanitized}`;
      }

      yield { type: "error", error: new Error(message) };
    } finally {
      if (requestTimer) {
        clearTimeout(requestTimer);
      }
      if (streamIdleTimer) {
        clearTimeout(streamIdleTimer);
      }
      if (signal) {
        signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }
}
