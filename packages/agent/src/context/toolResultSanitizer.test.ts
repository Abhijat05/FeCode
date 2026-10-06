import { describe, it, expect } from "vitest";
import { sanitizeToolResultForContext } from "./toolResultSanitizer.js";
import type { ToolResult } from "@fecode/models";

describe("sanitizeToolResultForContext", () => {
  it("preserves small tool results untouched and valid JSON", () => {
    const result: ToolResult<{ path: string; count: number }> = {
      success: true,
      output: { path: "src/index.ts", count: 42 }
    };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 1000 });
    expect(JSON.parse(sanitized)).toEqual(result);
  });

  it("truncates large output.content while guaranteeing valid JSON", () => {
    const largeContent = "line 1\n" + "x".repeat(30000) + "\nlast line";
    const result: ToolResult<{ path: string; content: string }> = {
      success: true,
      output: { path: "huge.txt", content: largeContent }
    };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 4000 });

    // Invariant 1: Must be valid JSON (never throw SyntaxError)
    expect(() => JSON.parse(sanitized)).not.toThrow();

    // Invariant 2: Output object structure preserved
    const parsed = JSON.parse(sanitized);
    expect(parsed.success).toBe(true);
    expect(parsed.output.path).toBe("huge.txt");
    expect(parsed.output.truncated).toBe(true);
    expect(parsed.output.content).toContain("line 1");
    expect(parsed.output.content).toContain("last line");
    expect(parsed.output.content).toContain("content truncated");
    expect(sanitized.length).toBeLessThanOrEqual(4000);
  });

  it("truncates large output.stdout from command executions while guaranteeing valid JSON", () => {
    const hugeStdout = "Test Suites: 50 passed\n" + "logs... ".repeat(5000) + "\nDone in 20s";
    const result: ToolResult<{ stdout: string; stderr: string; exitCode: number }> = {
      success: true,
      output: { stdout: hugeStdout, stderr: "", exitCode: 0 }
    };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 2000 });

    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = JSON.parse(sanitized);
    expect(parsed.success).toBe(true);
    expect(parsed.output.exitCode).toBe(0);
    expect(parsed.output.truncated).toBe(true);
    expect(parsed.output.stdout).toContain("Test Suites: 50 passed");
    expect(parsed.output.stdout).toContain("Done in 20s");
  });

  it("truncates large directory entries array while guaranteeing valid JSON", () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      name: `file_${i}.txt`,
      type: "file" as const
    }));
    const result: ToolResult<{ path: string; entries: typeof entries }> = {
      success: true,
      output: { path: "src", entries }
    };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 1500 });

    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = JSON.parse(sanitized);
    expect(parsed.output.entries.length).toBeLessThanOrEqual(50);
    expect(parsed.output.totalCount).toBe(500);
    expect(parsed.output.truncated).toBe(true);
  });

  it("handles complex arbitrary objects with structured preview fallback and valid JSON", () => {
    const complexObj: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      complexObj[`key_${i}`] = { nested: "val_".repeat(50), array: [1, 2, 3] };
    }
    const result = { success: true, output: complexObj };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 1000 });

    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = JSON.parse(sanitized);
    expect(parsed.success).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview).toBeDefined();
    expect(sanitized.length).toBeLessThanOrEqual(1000);
  });

  it("handles strings with quotes, newlines, and unicode without JSON parse corruption", () => {
    const specialChars = '"Hello" \n \r \t \\ \u2764 '.repeat(1000);
    const result: ToolResult<{ content: string }> = {
      success: true,
      output: { content: specialChars }
    };

    const sanitized = sanitizeToolResultForContext(result, { maxChars: 1500 });

    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = JSON.parse(sanitized);
    expect(parsed.success).toBe(true);
  });
});
