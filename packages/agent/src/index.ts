import type {
  ApprovalRequest,
  ModelProvider,
  ToolCall,
  ToolResult
} from "@fecode/models";
import type { ID } from "@fecode/shared";

export interface Agent {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
}

export interface AgentInput {
  message: string;
  cwd: string;
  sessionId?: string;
  provider?: ModelProvider;
  id?: ID;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "approval_required"; request: ApprovalRequest }
  | { type: "tool_result"; result: ToolResult; callId: string }
  | { type: "done" }
  | { type: "error"; error: Error };

export * from "./runtime.js";
export * from "./systemPrompt.js";
export * from "./tools/mockEchoTool.js";
export * from "./tools/mockWriteTool.js";
export * from "./tools/pathUtils.js";
export * from "./tools/ignoreUtils.js";
export * from "./tools/listDirectory.js";
export * from "./tools/readFile.js";
export * from "./tools/searchFiles.js";
export * from "./tools/writeFile.js";
export * from "./tools/defaultRegistry.js";
