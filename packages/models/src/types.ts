import type { ToolCall } from "./tools/types.js";

export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  maxContextTokens: number;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ModelRequest {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolDefinition[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ModelEvent =
  | {
      type: "text_delta";
      content: string;
    }
  | {
      type: "tool_call";
      call: ToolCall;
    }
  | {
      type: "completed";
      usage?: TokenUsage;
    }
  | {
      type: "error";
      error: Error;
    }
  | {
      type: "fallback";
      fromProvider: string;
      toProvider: string;
      reason: string;
      category?: string;
      attempt: number;
      maxAttempts: number;
      timestamp?: number;
      partialTextInterrupted?: boolean;
      attemptId?: string;
    };

export type ProviderAttemptState =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "exhausted"
  | "superseded"
  | "cancelled";

export interface ProviderAttemptInfo {
  id: string;
  providerId: string;
  attemptNumber: number;
  state: ProviderAttemptState;
  startedAt: number;
  completedAt?: number;
  tokensEmitted: number;
  error?: string;
}

export interface ModelProvider {
  id: string;
  capabilities: ModelCapabilities;
  generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent>;
}
