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
    };

export interface ModelProvider {
  id: string;
  capabilities: ModelCapabilities;
  generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent>;
}
