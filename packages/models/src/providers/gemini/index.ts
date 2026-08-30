import { GoogleGenAI, type Content, type Tool as GeminiTool } from "@google/genai";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  TokenUsage
} from "../../types.js";
import type { ToolCall } from "../../tools/types.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  client?: GoogleGenAI;
}

interface GeminiStreamChunk {
  text?: string;
  functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: { name: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiModelProvider implements ModelProvider {
  public readonly id = "gemini";
  public readonly model: string;
  private readonly apiKey: string;
  private readonly client: GoogleGenAI;

  public readonly capabilities: ModelCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 1048576
  };

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    this.apiKey = apiKey;
    this.model = options.model || process.env.FE_MODEL || "gemini-2.5-flash";
    this.client =
      options.client ||
      new GoogleGenAI({
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

      const geminiContents: Content[] = [];

      for (const msg of request.messages) {
        if (msg.role === "user") {
          const last = geminiContents[geminiContents.length - 1];
          if (
            last &&
            last.role === "user" &&
            Array.isArray(last.parts) &&
            !last.parts.some(
              (p) => typeof p === "object" && p !== null && "functionResponse" in p
            )
          ) {
            (last.parts as Array<Record<string, unknown>>).push({ text: msg.content || "" });
          } else {
            geminiContents.push({
              role: "user",
              parts: [{ text: msg.content || "" }]
            });
          }
        } else if (msg.role === "assistant") {
          const parts: Array<Record<string, unknown>> = [];
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              let parsedArgs = tc.arguments;
              if (typeof tc.arguments === "string") {
                try {
                  parsedArgs = JSON.parse(tc.arguments);
                } catch {
                  parsedArgs = {};
                }
              }
              parts.push({
                functionCall: {
                  name: tc.name,
                  args: (parsedArgs as Record<string, unknown>) || {}
                }
              });
            }
          }
          if (msg.content) {
            parts.push({ text: msg.content });
          }
          if (parts.length > 0) {
            geminiContents.push({
              role: "model",
              parts: parts as unknown as Content["parts"]
            });
          }
        } else if (msg.role === "tool") {
          let parsedResponse: unknown = msg.content;
          if (typeof msg.content === "string") {
            try {
              parsedResponse = JSON.parse(msg.content);
            } catch {
              parsedResponse = { output: msg.content };
            }
          }
          let toolName = msg.name;
          if (!toolName && msg.toolCallId) {
            for (const m of request.messages) {
              if (m.role === "assistant" && m.toolCalls) {
                const match = m.toolCalls.find((tc) => tc.id === msg.toolCallId);
                if (match) {
                  toolName = match.name;
                  break;
                }
              }
            }
          }
          const formattedResponse =
            parsedResponse &&
            typeof parsedResponse === "object" &&
            !Array.isArray(parsedResponse)
              ? (parsedResponse as Record<string, unknown>)
              : { output: parsedResponse };

          const fnResponsePart = {
            functionResponse: {
              name: toolName || "tool",
              response: formattedResponse
            }
          };

          const lastContent = geminiContents[geminiContents.length - 1];
          if (
            lastContent &&
            lastContent.role === "user" &&
            Array.isArray(lastContent.parts)
          ) {
            (lastContent.parts as Array<Record<string, unknown>>).push(fnResponsePart);
          } else {
            geminiContents.push({
              role: "user",
              parts: [fnResponsePart] as unknown as Content["parts"]
            });
          }
        }
      }

      const geminiTools: GeminiTool[] | undefined = request.tools?.length
        ? [
            {
              functionDeclarations: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: (t.inputSchema as Record<string, unknown>) || {
                  type: "object",
                  properties: {}
                }
              }))
            }
          ]
        : undefined;

      const responseStream = await this.client.models.generateContentStream({
        model: this.model,
        contents: geminiContents,
        config: {
          systemInstruction: request.system ? request.system : undefined,
          tools: geminiTools
        }
      });

      let usage: TokenUsage | undefined;
      let callCounter = 0;

      for await (const rawChunk of responseStream as AsyncIterable<unknown>) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }

        const chunk = rawChunk as GeminiStreamChunk;

        if (chunk.text) {
          yield { type: "text_delta", content: chunk.text };
        }

        if (chunk.functionCalls && Array.isArray(chunk.functionCalls)) {
          for (const fnCall of chunk.functionCalls) {
            callCounter++;
            const call: ToolCall = {
              id: `gemini-call-${Date.now()}-${callCounter}`,
              name: fnCall.name,
              arguments: fnCall.args || {}
            };
            yield { type: "tool_call", call };
          }
        } else if (chunk.candidates?.[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.functionCall) {
              callCounter++;
              const call: ToolCall = {
                id: `gemini-call-${Date.now()}-${callCounter}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args || {}
              };
              yield { type: "tool_call", call };
            }
          }
        }

        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
            totalTokens: chunk.usageMetadata.totalTokenCount
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
