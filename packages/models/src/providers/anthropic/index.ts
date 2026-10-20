import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  TokenUsage
} from "../../types.js";
import type { ToolCall } from "../../tools/types.js";
import { sanitizeReason, classifyProviderError } from "../../errors/classification.js";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  client?: Anthropic;
  clientFactory?: () => Anthropic;
  baseURL?: string;
  maxTokens?: number;
  timeoutMs?: number;
  streamIdleTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface AccumulatedBlock {
  type: "text" | "tool_use";
  id?: string;
  name?: string;
  argsBuffer?: string;
}

export class AnthropicModelProvider implements ModelProvider {
  public readonly id = "anthropic";
  public readonly model: string;
  public readonly maxTokens: number;
  public readonly timeoutMs: number;
  public readonly streamIdleTimeoutMs: number;
  public readonly maxRetries: number;
  public readonly retryDelayMs: number;
  private readonly apiKey: string;
  private readonly baseURL?: string;
  private client: Anthropic;
  private readonly customClient?: Anthropic;
  private readonly clientFactory?: () => Anthropic;

  public readonly capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 1000000
  };

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }
    this.apiKey = apiKey;
    this.model = options.model || process.env.FE_MODEL || "claude-sonnet-5-5";

    const envMaxTokens = process.env.FE_MAX_TOKENS;
    let parsedMaxTokens: number | undefined;
    if (envMaxTokens) {
      const parsed = parseInt(envMaxTokens, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        parsedMaxTokens = parsed;
      }
    }
    this.maxTokens =
      typeof options.maxTokens === "number" && options.maxTokens > 0
        ? options.maxTokens
        : (parsedMaxTokens ?? 8192);

    const envTimeout = process.env.FE_REQUEST_TIMEOUT_MS || process.env.ANTHROPIC_TIMEOUT_MS;
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

    const envMaxRetries = process.env.FE_NETWORK_MAX_RETRIES;
    let parsedMaxRetries: number | undefined;
    if (envMaxRetries) {
      const parsed = parseInt(envMaxRetries, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        parsedMaxRetries = parsed;
      }
    }
    this.maxRetries =
      typeof options.maxRetries === "number" && options.maxRetries >= 0
        ? options.maxRetries
        : (parsedMaxRetries ?? 3);

    const envRetryDelay = process.env.FE_NETWORK_RETRY_DELAY_MS;
    let parsedRetryDelay: number | undefined;
    if (envRetryDelay) {
      const parsed = parseInt(envRetryDelay, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        parsedRetryDelay = parsed;
      }
    }
    this.retryDelayMs =
      typeof options.retryDelayMs === "number" && options.retryDelayMs >= 0
        ? options.retryDelayMs
        : (parsedRetryDelay ?? 500);

    this.baseURL = options.baseURL || process.env.ANTHROPIC_BASE_URL;
    this.customClient = options.client;
    this.clientFactory = options.clientFactory;
    this.client =
      this.customClient ||
      (this.clientFactory ? this.clientFactory() : this.createClientInstance());
  }

  private createClientInstance(): Anthropic {
    return new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: this.timeoutMs > 0 ? this.timeoutMs : undefined,
      maxRetries: this.maxRetries
    });
  }

  private refreshClient(): void {
    if (this.clientFactory) {
      this.client = this.clientFactory();
    } else if (!this.customClient) {
      this.client = this.createClientInstance();
    }
  }

  private isTransientConnectionError(err: unknown): boolean {
    if (!err) return false;
    const classification = classifyProviderError(err);
    if (classification.category === "transient_network" || classification.isRetryable) {
      return true;
    }
    const errorObj = err as Record<string, unknown>;
    const name = typeof errorObj.name === "string" ? errorObj.name : "";
    const msg = typeof errorObj.message === "string" ? errorObj.message.toLowerCase() : "";
    const causeObj = errorObj.cause as Record<string, unknown> | undefined;
    const causeMsg = typeof causeObj?.message === "string" ? causeObj.message.toLowerCase() : "";
    const causeCode = typeof causeObj?.code === "string" ? causeObj.code : "";
    const code = typeof errorObj.code === "string" ? errorObj.code : causeCode;

    return (
      name === "APIConnectionError" ||
      name === "APIConnectionTimeoutError" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ECONNREFUSED" ||
      code === "UND_ERR_SOCKET" ||
      msg.includes("econnreset") ||
      msg.includes("connection reset") ||
      msg.includes("socket hang up") ||
      msg.includes("connection error") ||
      msg.includes("fetch failed") ||
      msg.includes("network error") ||
      causeMsg.includes("econnreset") ||
      causeMsg.includes("connection reset") ||
      causeMsg.includes("socket hang up")
    );
  }

  private calculateBackoffDelay(attempt: number): number {
    const base = this.retryDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * Math.min(200, base * 0.25));
    return Math.min(10000, base + jitter);
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return;
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      timer = setTimeout(() => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve();
      }, ms);
    });
  }

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    if (signal?.aborted) {
      yield { type: "error", error: new Error("Request aborted") };
      return;
    }

    // Anthropic has no "system" role in messages[] — request.system plus any
    // role:"system" ModelMessage are merged into one top-level `system` string.
    const systemParts: string[] = [];
    const seenSystem = new Set<string>();
    if (request.system?.trim() && !seenSystem.has(request.system.trim())) {
      systemParts.push(request.system.trim());
      seenSystem.add(request.system.trim());
    }
    for (const msg of request.messages) {
      if (msg.role === "system" && msg.content?.trim() && !seenSystem.has(msg.content.trim())) {
        systemParts.push(msg.content.trim());
        seenSystem.add(msg.content.trim());
      }
    }
    const systemText = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    // Anthropic also has no "tool" role — a tool result becomes a user-role
    // message whose content is an array of tool_result blocks. Consecutive
    // tool-role ModelMessages are grouped into ONE user message (parallel
    // tool results must come back together, not split across messages).
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        continue;
      }

      if (msg.role === "user") {
        anthropicMessages.push({ role: "user", content: msg.content || "" });
      } else if (msg.role === "assistant") {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            let input: unknown = tc.arguments;
            if (typeof tc.arguments === "string") {
              try {
                input = JSON.parse(tc.arguments);
              } catch {
                input = {};
              }
            }
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: (input as Record<string, unknown>) || {}
            });
          }
        }
        anthropicMessages.push({
          role: "assistant",
          content: blocks.length > 0 ? blocks : (msg.content || "")
        });
      } else if (msg.role === "tool") {
        const resultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: msg.toolCallId || "",
          content: msg.content || ""
        };
        const last = anthropicMessages[anthropicMessages.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)) {
          (last.content as Anthropic.ContentBlockParam[]).push(resultBlock);
        } else {
          anthropicMessages.push({ role: "user", content: [resultBlock] });
        }
      }
    }

    const anthropicTools: Anthropic.Tool[] | undefined = request.tools?.length
      ? request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: (t.inputSchema as Anthropic.Tool.InputSchema) || {
            type: "object",
            properties: {}
          }
        }))
      : undefined;

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }

      attempt++;
      const timeoutController = new AbortController();
      let timeoutError: Error | null = null;
      let requestTimer: NodeJS.Timeout | null = null;
      let streamIdleTimer: NodeJS.Timeout | null = null;

      const onCallerAbort = () => {
        timeoutController.abort(signal?.reason || new Error("Request aborted"));
      };

      if (signal) {
        signal.addEventListener("abort", onCallerAbort, { once: true });
      }

      try {
        if (this.timeoutMs > 0) {
          requestTimer = setTimeout(() => {
            timeoutError = new Error(
              `Anthropic request timed out after ${this.timeoutMs}ms (model: "${this.model}").`
            );
            timeoutController.abort(timeoutError);
          }, this.timeoutMs);
        }

        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        const blocks = new Map<number, AccumulatedBlock>();

        const resetStreamIdleTimer = () => {
          if (streamIdleTimer) {
            clearTimeout(streamIdleTimer);
            streamIdleTimer = null;
          }
          if (this.streamIdleTimeoutMs > 0) {
            streamIdleTimer = setTimeout(() => {
              timeoutError = new Error(
                `Anthropic stream stalled: no data received for ${this.streamIdleTimeoutMs}ms (model: "${this.model}").`
              );
              timeoutController.abort(timeoutError);
            }, this.streamIdleTimeoutMs);
          }
        };

        resetStreamIdleTimer();

        // Note: client.messages.stream() returns the MessageStream
        // synchronously (unlike OpenAI's awaited create() call), so there is
        // only one try/catch stage here covering both connection failures and
        // mid-stream failures; chunksReceivedCount still gates retry-eligibility
        // so a failure after partial output is never silently replayed.
        let chunksReceivedCount = 0;
        try {
          const stream = this.client.messages.stream(
            {
              model: this.model,
              max_tokens: this.maxTokens,
              system: systemText,
              messages: anthropicMessages,
              tools: anthropicTools
            },
            {
              signal: timeoutController.signal,
              timeout: this.timeoutMs > 0 ? this.timeoutMs : undefined
            }
          );

          for await (const event of stream) {
            chunksReceivedCount++;
            resetStreamIdleTimer();

            if (signal?.aborted) {
              throw new Error("Request aborted");
            }

            switch (event.type) {
              case "message_start":
                inputTokens = event.message.usage.input_tokens;
                break;
              case "content_block_start":
                if (event.content_block.type === "text") {
                  blocks.set(event.index, { type: "text" });
                } else if (event.content_block.type === "tool_use") {
                  blocks.set(event.index, {
                    type: "tool_use",
                    id: event.content_block.id,
                    name: event.content_block.name,
                    argsBuffer: ""
                  });
                }
                break;
              case "content_block_delta":
                if (event.delta.type === "text_delta") {
                  yield { type: "text_delta", content: event.delta.text };
                } else if (event.delta.type === "input_json_delta") {
                  const block = blocks.get(event.index);
                  if (block) {
                    block.argsBuffer = (block.argsBuffer || "") + event.delta.partial_json;
                  }
                }
                break;
              case "content_block_stop": {
                const block = blocks.get(event.index);
                if (block?.type === "tool_use") {
                  let parsedArgs: unknown = {};
                  if (block.argsBuffer && block.argsBuffer.trim()) {
                    try {
                      parsedArgs = JSON.parse(block.argsBuffer);
                    } catch {
                      parsedArgs = block.argsBuffer;
                    }
                  }
                  const call: ToolCall = {
                    id:
                      block.id ||
                      `anthropic-call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                    name: block.name || "",
                    arguments: parsedArgs
                  };
                  yield { type: "tool_call", call };
                }
                blocks.delete(event.index);
                break;
              }
              case "message_delta":
                if (event.usage.output_tokens !== undefined && event.usage.output_tokens !== null) {
                  outputTokens = event.usage.output_tokens;
                }
                break;
              case "message_stop":
                break;
            }
          }
        } catch (streamErr: unknown) {
          if (timeoutError) {
            throw timeoutError;
          }
          if (signal?.aborted) {
            throw new Error("Request aborted");
          }

          if (
            chunksReceivedCount === 0 &&
            this.isTransientConnectionError(streamErr) &&
            attempt <= this.maxRetries
          ) {
            this.refreshClient();
            const delay = this.calculateBackoffDelay(attempt);
            await this.sleepWithAbort(delay, signal);
            continue;
          }
          throw streamErr;
        } finally {
          if (streamIdleTimer) {
            clearTimeout(streamIdleTimer);
            streamIdleTimer = null;
          }
        }

        let usage: TokenUsage | undefined;
        if (inputTokens !== undefined || outputTokens !== undefined) {
          usage = {
            inputTokens,
            outputTokens,
            totalTokens:
              inputTokens !== undefined && outputTokens !== undefined
                ? inputTokens + outputTokens
                : undefined
          };
        }

        yield { type: "completed", usage };
        return;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errorObj = error as unknown as Record<string, unknown>;
        const cause = errorObj.cause as Record<string, unknown> | undefined;
        const causeMsg = typeof cause?.message === "string" ? cause.message : "";
        const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
        const errCode = typeof errorObj.code === "string" ? (errorObj.code as string) : causeCode;

        let sanitized = sanitizeReason(error.message);
        if (causeMsg) {
          sanitized = `${sanitized} (${sanitizeReason(causeMsg)})`;
        }
        if (this.apiKey) {
          sanitized = sanitized.split(this.apiKey).join("[REDACTED_API_KEY]");
        }
        let message = sanitized;

        if (timeoutError) {
          message = (timeoutError as Error).message;
        } else if (
          errCode === "ECONNRESET" ||
          sanitized.toLowerCase().includes("econnreset") ||
          sanitized.toLowerCase().includes("connection reset") ||
          sanitized.toLowerCase().includes("socket hang up")
        ) {
          message = `Anthropic connection reset by peer (ECONNRESET) after ${attempt} attempt(s). Original error: ${sanitized}`;
        } else if (
          sanitized.toLowerCase().includes("timed out") ||
          sanitized.toLowerCase().includes("timeout") ||
          sanitized.toLowerCase().includes("stream stalled") ||
          error.name === "TimeoutError" ||
          error.name === "APIConnectionTimeoutError"
        ) {
          message = sanitized;
        } else if (
          error.name === "AuthenticationError" ||
          sanitized.includes("401") ||
          sanitized.toLowerCase().includes("invalid x-api-key") ||
          sanitized.toLowerCase().includes("authentication_error")
        ) {
          message = `Anthropic API key is invalid or unauthorized. Please check your ANTHROPIC_API_KEY environment variable. Original error: ${sanitized}`;
        } else if (
          error.name === "RateLimitError" ||
          sanitized.includes("429") ||
          sanitized.toLowerCase().includes("rate_limit_error")
        ) {
          message = `Anthropic quota exceeded or rate limit reached (429 RateLimit). Please wait a moment before retrying.`;
        }

        const outError = new Error(message);
        if (errCode) {
          Object.assign(outError, { code: errCode });
        }
        if (error.cause) {
          Object.assign(outError, { cause: error.cause });
        }

        yield { type: "error", error: outError };
        return;
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
}
