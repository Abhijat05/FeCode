import type {
  ApprovalRequest,
  ModelProvider,
  ToolCall,
  ToolResult
} from "@fecode/models";
import type { ID } from "@fecode/shared";

import type { TaskPlan } from "./tasks/types.js";
import type { TaskCompletionSummary } from "./completion/types.js";
import type { PersistedSessionData } from "./session/types.js";

export interface Agent {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  clear?(): void;
  getCompletionSummary?(): TaskCompletionSummary;
  restoreSession?(data: PersistedSessionData): void;
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
  | { type: "error"; error: Error }
  | { type: "skills_activated"; skills: string[] }
  | { type: "plan_created"; plan: TaskPlan }
  | { type: "plan_step_started"; planId: string; stepId: string; stepIndex: number }
  | { type: "plan_step_completed"; planId: string; stepId: string; stepIndex: number }
  | { type: "plan_step_failed"; planId: string; stepId: string; stepIndex: number; error?: string }
  | { type: "task_summary"; summary: TaskCompletionSummary }
  | { type: "run_started"; runId: string }
  | {
      type: "state_changed";
      runId?: string;
      from: import("./run/types.js").AgentRunStatus;
      to: import("./run/types.js").AgentRunStatus;
      reason: string;
      timestamp?: number;
    }
  | { type: "tool_started"; runId?: string; toolName: string; callId: string }
  | { type: "tool_completed"; runId?: string; toolName: string; callId: string; success: boolean }
  | { type: "verification_started"; runId?: string; command: string; attempt: number }
  | { type: "verification_completed"; runId?: string; command: string; success: boolean; attempt: number }
  | { type: "recovery_started"; runId?: string; checkpointId: string }
  | { type: "recovery_completed"; runId?: string; checkpointId: string; success: boolean }
  | { type: "run_completed"; runId: string }
  | { type: "run_failed"; runId: string; code?: string; error?: string }
  | { type: "run_cancelled"; runId: string };

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
export * from "./project/index.js";
export * from "./skills/types.js";
export * from "./skills/registry.js";
export * from "./skills/builtins/index.js";
export * from "./skills/recommender.js";
export * from "./skills/selector.js";
export * from "./skills/composer.js";
export * from "./skills/parser.js";
export * from "./skills/loader.js";
export * from "./skills/requestRecommender.js";
export * from "./skills/activation.js";
export * from "./optimization/index.js";
export * from "./policies/index.js";
export * from "./tasks/index.js";
export * from "./exploration/index.js";
export * from "./context/index.js";
export * from "./editing/index.js";
export * from "./strategy/index.js";
export * from "./completion/index.js";
export * from "./session/index.js";
export * from "./changes/index.js";
export * from "./git/index.js";
export * from "./checkpoints/index.js";
export * from "./recovery/index.js";
export * from "./policy/index.js";
export * from "./run/index.js";
export * from "./diagnostics/index.js";
