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
export * from "./tools/diffUtils.js";
export * from "./tools/ignoreUtils.js";
export * from "./tools/listDirectory.js";
export * from "./tools/readFile.js";
export * from "./tools/searchFiles.js";
export * from "./tools/writeFile.js";
export * from "./tools/editFile.js";
export * from "./tools/defaultRegistry.js";
export * from "./commands/types.js";
export * from "./commands/policy.js";
export * from "./commands/nodeExecutor.js";
export * from "./commands/mockExecutor.js";
export * from "./commands/executeCommandTool.js";
export * from "./project/types.js";
export * from "./project/detector.js";
export * from "./skills/types.js";
export * from "./skills/registry.js";
export * from "./skills/builtins/index.js";
export * from "./skills/recommender.js";
export * from "./skills/selector.js";
export * from "./skills/composer.js";
