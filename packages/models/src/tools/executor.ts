import type {
  ToolCall,
  ToolContext,
  ToolExecutor,
  ToolRegistry,
  ToolResult
} from "./types.js";

export class DefaultToolExecutor implements ToolExecutor {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        success: false,
        error: {
          message: `Tool not found: ${call.name}`,
          code: "TOOL_NOT_FOUND"
        }
      };
    }

    try {
      let parsedArgs = call.arguments;
      if (typeof call.arguments === "string" && call.arguments.trim()) {
        try {
          parsedArgs = JSON.parse(call.arguments);
        } catch (jsonErr: unknown) {
          const parseMsg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
          return {
            success: false,
            error: {
              message: `Tool arguments failed JSON parsing: ${parseMsg}. Raw payload: "${call.arguments}". Please reissue the tool call with valid JSON.`,
              code: "INVALID_JSON_ARGUMENTS"
            }
          };
        }
      }

      const result = await tool.execute(parsedArgs, context);
      if (
        !result ||
        typeof result !== "object" ||
        typeof (result as ToolResult).success !== "boolean"
      ) {
        return {
          success: false,
          error: {
            message: `Tool returned an invalid result format: expected { success: boolean, ... }, got ${typeof result}`,
            code: "MALFORMED_TOOL_RESULT"
          }
        };
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          message: `Tool execution failed: ${message}`,
          code: "EXECUTION_FAILED"
        }
      };
    }
  }
}
