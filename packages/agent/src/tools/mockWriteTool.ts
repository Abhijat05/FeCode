import type { Tool, ToolContext, ToolResult } from "@fecode/models";

export interface MockWriteInput {
  path: string;
  content: string;
}

export interface MockWriteOutput {
  path: string;
  bytesWritten: number;
}

export class MockWriteTool implements Tool<MockWriteInput, MockWriteOutput> {
  public readonly name = "mock_write";
  public readonly permissionCategory = "write";
  public readonly description =
    "Mock write tool for testing permissions and approval pipeline.";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }
    },
    required: ["path", "content"]
  };

  async execute(
    input: MockWriteInput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: ToolContext
  ): Promise<ToolResult<MockWriteOutput>> {
    return {
      success: true,
      output: {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content || "", "utf-8")
      }
    };
  }
}
