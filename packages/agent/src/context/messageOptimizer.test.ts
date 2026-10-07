import { describe, it, expect } from "vitest";
import { prepareModelMessages } from "./messageOptimizer.js";
import type { ModelMessage } from "@fecode/models";

describe("prepareModelMessages", () => {
  it("returns empty array for empty messages", () => {
    expect(prepareModelMessages([])).toEqual([]);
  });

  it("strips internal thinking tags from assistant messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "What is 2+2?" },
      {
        role: "assistant",
        content: "<think>Let me calculate 2+2. It is 4.</think>The answer is 4."
      }
    ];

    const prepared = prepareModelMessages(messages, 4000);
    expect(prepared[1].content).toBe("The answer is 4.");
    expect(prepared[1].content).not.toContain("<think>");
  });

  it("truncates excessively large tool results retaining head and tail", () => {
    const hugeToolOutput = "START_TOOL_OUTPUT_" + "X".repeat(10000) + "_END_TOOL_OUTPUT";
    const messages: ModelMessage[] = [
      { role: "user", content: "List directory" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_1", name: "list_directory", arguments: {} }]
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: hugeToolOutput
      }
    ];

    const prepared = prepareModelMessages(messages, 16000, { maxToolResultChars: 1000 });
    const toolMsg = prepared.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBeDefined();
    expect(toolMsg?.content).toContain("START_TOOL_OUTPUT_");
    expect(toolMsg?.content).toContain("_END_TOOL_OUTPUT");
    expect(toolMsg?.content).toContain("output truncated for context budget");
    expect(toolMsg!.content!.length).toBeLessThan(hugeToolOutput.length);
  });

  it("truncates large JSON tool results while strictly maintaining valid JSON syntax", () => {
    const jsonToolOutput = JSON.stringify({
      success: true,
      output: {
        path: "huge_file.ts",
        content: "const a = 1;\n" + "console.log('line');\n".repeat(2000) + "const z = 99;\n"
      }
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Read huge file" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_read", name: "read_file", arguments: { path: "huge_file.ts" } }]
      },
      {
        role: "tool",
        toolCallId: "call_read",
        content: jsonToolOutput
      }
    ];

    const prepared = prepareModelMessages(messages, 16000, { maxToolResultChars: 1500 });
    const toolMsg = prepared.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBeDefined();

    // Must be valid JSON (never throw SyntaxError)
    expect(() => JSON.parse(toolMsg!.content!)).not.toThrow();

    const parsed = JSON.parse(toolMsg!.content!);
    expect(parsed.success).toBe(true);
    expect(parsed.output?.truncated).toBe(true);
    expect(toolMsg!.content!.length).toBeLessThanOrEqual(1500);
  });


  it("compacts older turns at clean user boundaries when total tokens exceed budget", () => {
    // 3 distinct turns
    const messages: ModelMessage[] = [
      // Turn 1
      { role: "user", content: "Turn 1: Please analyze this codebase: " + "A".repeat(5000) },
      { role: "assistant", content: "Turn 1 answer: " + "B".repeat(5000) },
      // Turn 2
      { role: "user", content: "Turn 2: Now do this task: " + "C".repeat(5000) },
      { role: "assistant", content: "Turn 2 answer: " + "D".repeat(5000) },
      // Turn 3 (Active Turn)
      { role: "user", content: "Turn 3: What is the current status?" }
    ];

    // Budget of only 2000 tokens (Turn 1 and 2 exceed 2000 tokens)
    const prepared = prepareModelMessages(messages, 2000);

    // Turn 1 and Turn 2 should have been dropped/compacted
    const userPrompts = prepared
      .filter((m) => m.role === "user")
      .map((m) => m.content);

    expect(userPrompts.some((p) => p?.includes("Earlier conversation history was compacted"))).toBe(true);
    // Active turn MUST be preserved!
    expect(userPrompts.some((p) => p?.includes("Turn 3: What is the current status?"))).toBe(true);
    // Old bloated Turn 1 must not be in prepared messages
    expect(userPrompts.some((p) => p?.includes("Turn 1: Please analyze"))).toBe(false);
  });

  it("strictly preserves tool calls and tool results pairings", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Old question" },
      { role: "assistant", content: "Old answer" },
      { role: "user", content: "Active question with tool" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_abc", name: "test_tool", arguments: {} }]
      },
      {
        role: "tool",
        toolCallId: "call_abc",
        content: "Tool result output"
      }
    ];

    const prepared = prepareModelMessages(messages, 500);
    const hasCall = prepared.some((m) => m.role === "assistant" && m.toolCalls?.some((tc) => tc.id === "call_abc"));
    const hasResult = prepared.some((m) => m.role === "tool" && m.toolCallId === "call_abc");
    expect(hasCall).toBe(true);
    expect(hasResult).toBe(true);
  });

  it("compacts older tool results in single-turn sessions when total tokens exceed budget", () => {
    // Single user prompt with 6 sequential tool calls and results
    const messages: ModelMessage[] = [
      { role: "user", content: "Audit this repository" }
    ];

    for (let i = 1; i <= 6; i++) {
      messages.push({
        role: "assistant",
        toolCalls: [{ id: `call_${i}`, name: "read_file", arguments: { path: `file_${i}.ts` } }]
      });
      messages.push({
        role: "tool",
        toolCallId: `call_${i}`,
        content: `File ${i} contents: ` + "A".repeat(2000)
      });
    }

    // Budget of 1200 tokens (messages exceed 3000 tokens)
    const prepared = prepareModelMessages(messages, 1200);

    // All toolCallId pairings must be preserved
    for (let i = 1; i <= 6; i++) {
      expect(prepared.some((m) => m.role === "tool" && m.toolCallId === `call_${i}`)).toBe(true);
    }

    // Older tool results (e.g. call_1, call_2) should be compacted/omitted to meet the budget
    const tool1 = prepared.find((m) => m.role === "tool" && m.toolCallId === "call_1");
    expect(tool1?.content).toContain("omitted");
    expect(tool1!.content!.length).toBeLessThan(500);

    // Most recent tool result (call_6) should be preserved
    const tool6 = prepared.find((m) => m.role === "tool" && m.toolCallId === "call_6");
    expect(tool6?.content).toContain("File 6 contents");
  });

  it("compacts older tool results in active turn after dropping earlier conversation turns", () => {
    // Turn 1
    const messages: ModelMessage[] = [
      { role: "user", content: "Turn 1: " + "X".repeat(2000) },
      { role: "assistant", content: "Turn 1 answer: " + "Y".repeat(2000) },
      // Turn 2 (Active turn with multiple tool calls exceeding budget)
      { role: "user", content: "Turn 2: Run multiple tools" }
    ];

    for (let i = 1; i <= 4; i++) {
      messages.push({
        role: "assistant",
        toolCalls: [{ id: `call_t2_${i}`, name: "search_files", arguments: { query: `term_${i}` } }]
      });
      messages.push({
        role: "tool",
        toolCallId: `call_t2_${i}`,
        content: `Search result ${i}: ` + "Z".repeat(2000)
      });
    }

    const prepared = prepareModelMessages(messages, 1200);

    // Old turn 1 should be compacted away
    expect(prepared.some((m) => m.content?.includes("Turn 1:"))).toBe(false);
    // Context notice should be present
    expect(prepared.some((m) => m.content?.includes("Earlier conversation history was compacted"))).toBe(true);
    // Tool results should be preserved in pairing
    for (let i = 1; i <= 4; i++) {
      expect(prepared.some((m) => m.role === "tool" && m.toolCallId === `call_t2_${i}`)).toBe(true);
    }
    // Older tool in active turn should be compacted
    const tool1 = prepared.find((m) => m.role === "tool" && m.toolCallId === "call_t2_1");
    expect(tool1?.content).toContain("omitted");
    // Latest tool should be preserved
    const tool4 = prepared.find((m) => m.role === "tool" && m.toolCallId === "call_t2_4");
    expect(tool4?.content).toContain("Search result 4");
  });

  it("scales tool result char limit dynamically with large token budgets", () => {
    // 20,000 char tool output (approx 4,500 tokens)
    const largeToolOutput = "function complexComponent() {\n" + "  console.log('line');\n".repeat(800) + "}";
    expect(largeToolOutput.length).toBeGreaterThan(15000);

    const messages: ModelMessage[] = [
      { role: "user", content: "Read complexComponent" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_read_1", name: "read_file", arguments: { path: "src/Complex.tsx" } }]
      },
      {
        role: "tool",
        toolCallId: "call_read_1",
        content: largeToolOutput
      }
    ];

    // With a generous budget (e.g. 64,000 tokens as in Gemini / GPT-4o)
    const prepared = prepareModelMessages(messages, 64000);
    const toolMsg = prepared.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe(largeToolOutput);
    expect(toolMsg?.content).not.toContain("output truncated for context budget");
  });

  it("extracts structured task and file summary when turns are compacted", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Implement authentication service in src/auth.ts" },
      {
        role: "assistant",
        toolCalls: [
          { id: "call_write", name: "write_file", arguments: { path: "src/auth.ts" } },
          { id: "call_cmd", name: "execute_command", arguments: { command: "npm test" } }
        ]
      },
      { role: "tool", toolCallId: "call_write", content: "File written successfully" },
      { role: "tool", toolCallId: "call_cmd", content: "Tests passed: 5" },
      { role: "assistant", content: "Authentication is implemented and tests pass. " + "X".repeat(5000) },
      // Active turn
      { role: "user", content: "Now write integration tests" }
    ];

    const prepared = prepareModelMessages(messages, 1000);

    const userMessages = prepared.filter((m) => m.role === "user");
    const notice = userMessages.find((m) => m.content?.includes("Earlier conversation history was compacted"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("• Previous Tasks:");
    expect(notice?.content).toContain("Implement authentication service");
    expect(notice?.content).toContain("• Modified Files:");
    expect(notice?.content).toContain("src/auth.ts");
    expect(notice?.content).toContain("• Executed Commands:");
    expect(notice?.content).toContain("npm test");
  });

  it("uses custom summarizeCompactedTurns option when provided", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Task 1 " + "A".repeat(5000) },
      { role: "assistant", content: "Done 1 " + "B".repeat(5000) },
      { role: "user", content: "Task 2 (active)" }
    ];

    const prepared = prepareModelMessages(messages, 1000, {
      summarizeCompactedTurns: () => "Custom LLM Summary: User completed task 1 successfully."
    });

    const notice = prepared.find((m) => m.role === "user" && m.content?.includes("Custom LLM Summary"));
    expect(notice).toBeDefined();
    expect(notice?.content).toContain("Custom LLM Summary: User completed task 1 successfully.");
  });
});
