import type { ModelMessage, ModelProvider, ModelRequest, TokenUsage } from "@fecode/models";
import type { Agent, AgentEvent, AgentInput } from "./index.js";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentState {
  sessionId: string;
  status: AgentStatus;
  messages: ModelMessage[];
  tokenUsage?: TokenUsage;
}

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  sessionId?: string;
}

export class AgentRuntime implements Agent {
  private readonly modelProvider: ModelProvider;
  private readonly systemPrompt: string;
  private state: AgentState;
  private activeController: AbortController | null = null;

  constructor(modelProvider: ModelProvider, options: AgentRuntimeOptions = {}) {
    this.modelProvider = modelProvider;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.state = {
      sessionId:
        options.sessionId ||
        `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      status: "idle",
      messages: []
    };
  }

  public getState(): AgentState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      tokenUsage: this.state.tokenUsage ? { ...this.state.tokenUsage } : undefined
    };
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (input.sessionId && this.state.messages.length === 0) {
      this.state.sessionId = input.sessionId;
    }

    this.state.status = "running";
    this.activeController = new AbortController();

    this.state.messages.push({
      role: "user",
      content: input.message
    });

    const request: ModelRequest = {
      system: this.systemPrompt,
      messages: [...this.state.messages]
    };

    let accumulatedText = "";

    try {
      const stream = this.modelProvider.generate(
        request,
        this.activeController.signal
      );

      for await (const event of stream) {
        if (event.type === "text_delta") {
          accumulatedText += event.content;
          yield { type: "text", content: event.content };
        } else if (event.type === "completed") {
          this.state.messages.push({
            role: "assistant",
            content: accumulatedText
          });

          if (event.usage) {
            const currentUsage = this.state.tokenUsage || {};
            this.state.tokenUsage = {
              inputTokens:
                (currentUsage.inputTokens || 0) + (event.usage.inputTokens || 0),
              outputTokens:
                (currentUsage.outputTokens || 0) + (event.usage.outputTokens || 0),
              totalTokens:
                (currentUsage.totalTokens || 0) + (event.usage.totalTokens || 0)
            };
          }

          this.state.status = "completed";
          yield { type: "done" };
        } else if (event.type === "error") {
          const isCancelled =
            this.activeController?.signal.aborted ||
            event.error.message.toLowerCase().includes("abort") ||
            event.error.message.toLowerCase().includes("cancel");

          this.state.status = isCancelled ? "cancelled" : "failed";
          yield { type: "error", error: event.error };
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isCancelled =
        this.activeController?.signal.aborted ||
        error.message.toLowerCase().includes("abort") ||
        error.message.toLowerCase().includes("cancel");

      this.state.status = isCancelled ? "cancelled" : "failed";
      yield { type: "error", error };
    } finally {
      this.activeController = null;
    }
  }

  async cancel(): Promise<void> {
    if (this.activeController) {
      this.state.status = "cancelled";
      this.activeController.abort();
    }
  }
}
