import {
  DefaultToolExecutor,
  DefaultToolRegistry
} from "@fecode/models";
import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  TokenUsage,
  ToolCall,
  ToolExecutor,
  ToolRegistry
} from "@fecode/models";
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
  registry?: ToolRegistry;
  executor?: ToolExecutor;
}

export class AgentRuntime implements Agent {
  private readonly modelProvider: ModelProvider;
  private readonly systemPrompt: string;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private state: AgentState;
  private activeController: AbortController | null = null;

  constructor(modelProvider: ModelProvider, options: AgentRuntimeOptions = {}) {
    this.modelProvider = modelProvider;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.registry = options.registry || new DefaultToolRegistry();
    this.executor =
      options.executor || new DefaultToolExecutor(this.registry);

    this.state = {
      sessionId:
        options.sessionId ||
        `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      status: "idle",
      messages: []
    };
  }

  public getRegistry(): ToolRegistry {
    return this.registry;
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

    try {
      while (true) {
        if (this.activeController.signal.aborted) {
          throw new Error("Request aborted");
        }

        const registeredTools = this.registry.list();
        const toolDefinitions = registeredTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));

        const request: ModelRequest = {
          system: this.systemPrompt,
          messages: [...this.state.messages],
          tools: toolDefinitions.length ? toolDefinitions : undefined
        };

        let accumulatedText = "";
        const toolCallsForTurn: ToolCall[] = [];
        let turnError: Error | null = null;

        const stream = this.modelProvider.generate(
          request,
          this.activeController.signal
        );

        for await (const event of stream) {
          if (event.type === "text_delta") {
            accumulatedText += event.content;
            yield { type: "text", content: event.content };
          } else if (event.type === "tool_call") {
            toolCallsForTurn.push(event.call);
            yield { type: "tool_call", call: event.call };
          } else if (event.type === "completed") {
            if (event.usage) {
              const currentUsage = this.state.tokenUsage || {};
              this.state.tokenUsage = {
                inputTokens:
                  (currentUsage.inputTokens || 0) +
                  (event.usage.inputTokens || 0),
                outputTokens:
                  (currentUsage.outputTokens || 0) +
                  (event.usage.outputTokens || 0),
                totalTokens:
                  (currentUsage.totalTokens || 0) +
                  (event.usage.totalTokens || 0)
              };
            }
          } else if (event.type === "error") {
            turnError = event.error;
            yield { type: "error", error: event.error };
            break;
          }
        }

        if (turnError) {
          const isCancelled =
            this.activeController.signal.aborted ||
            turnError.message.toLowerCase().includes("abort") ||
            turnError.message.toLowerCase().includes("cancel");
          this.state.status = isCancelled ? "cancelled" : "failed";
          break;
        }

        this.state.messages.push({
          role: "assistant",
          content: accumulatedText || undefined,
          toolCalls: toolCallsForTurn.length ? toolCallsForTurn : undefined
        });

        if (toolCallsForTurn.length === 0) {
          this.state.status = "completed";
          yield { type: "done" };
          break;
        }

        for (const call of toolCallsForTurn) {
          if (this.activeController.signal.aborted) {
            throw new Error("Request aborted");
          }

          const result = await this.executor.execute(call, {
            cwd: input.cwd,
            signal: this.activeController.signal
          });

          yield { type: "tool_result", result, callId: call.id };

          this.state.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result)
          });
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
