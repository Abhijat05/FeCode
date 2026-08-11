export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  maxContextTokens: number;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  system?: string;
  messages: ModelMessage[];
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
