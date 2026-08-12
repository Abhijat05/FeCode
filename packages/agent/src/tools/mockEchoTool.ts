import type { Tool, ToolResult } from "@fecode/models";

export interface EchoInput {
  message: string;
}

export interface EchoOutput {
  message: string;
}

export class MockEchoTool implements Tool<EchoInput, EchoOutput> {
  public readonly name = "echo";
  public readonly permissionCategory = "read";
  public readonly description = "Echoes back the input message.";
  public inputSchema = {
    type: "object",
    properties: {
      message: { type: "string" }
    },
    required: ["message"]
  };

  async execute(
    input: EchoInput
  ): Promise<ToolResult<EchoOutput>> {
    return {
      success: true,
      output: { message: input?.message }
    };
  }
}
