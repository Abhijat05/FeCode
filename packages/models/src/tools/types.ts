export type ToolPermissionCategory = "read" | "write" | "execute" | "network";

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: {
    message: string;
    code?: string;
  };
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  permissionCategory?: ToolPermissionCategory;

  execute(
    input: TInput,
    context: ToolContext
  ): Promise<ToolResult<TOutput>>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
}

export interface ToolExecutor {
  execute(
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolResult>;
}
