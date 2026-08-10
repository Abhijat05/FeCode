import type { ModelProvider } from "@fecode/models";
import type { ID } from "@fecode/shared";

export interface Agent {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
}

export interface AgentInput {
  message: string;
  cwd: string;
  provider?: ModelProvider;
  id?: ID;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "done" }
  | { type: "error"; error: Error };
