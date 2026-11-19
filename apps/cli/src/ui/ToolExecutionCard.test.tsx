import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  ToolExecutionCard,
  ToolExecutionGroup,
  formatToolDuration,
  getCleanToolName
} from "./ToolExecutionCard.js";

describe("ToolExecutionCard", () => {
  describe("formatToolDuration", () => {
    it("formats ms duration", () => {
      expect(formatToolDuration(45)).toBe("45ms");
      expect(formatToolDuration(950)).toBe("950ms");
    });

    it("formats second duration", () => {
      expect(formatToolDuration(1500)).toBe("1.5s");
      expect(formatToolDuration(3200)).toBe("3.2s");
    });

    it("returns empty string when undefined or non-positive", () => {
      expect(formatToolDuration(undefined)).toBe("");
      expect(formatToolDuration(0)).toBe("");
    });
  });

  describe("getCleanToolName", () => {
    it("normalizes common tool names", () => {
      expect(getCleanToolName("read_file")).toBe("Read");
      expect(getCleanToolName("edit_file")).toBe("Edit");
      expect(getCleanToolName("write_file")).toBe("Write");
      expect(getCleanToolName("run_command")).toBe("Exec");
      expect(getCleanToolName("search_files")).toBe("Search");
      expect(getCleanToolName("list_directory")).toBe("List");
      expect(getCleanToolName("custom_tool")).toBe("custom_tool");
    });
  });

  describe("ToolExecutionCard rendering", () => {
    it("renders successful tool call with target and duration", () => {
      const { lastFrame } = render(
        <ToolExecutionCard
          toolCall={{
            id: "1",
            name: "read_file",
            target: "src/App.tsx",
            status: "success",
            durationMs: 25
          }}
        />
      );
      const output = lastFrame() || "";
      expect(output).toContain("Read");
      expect(output).toContain("src/App.tsx");
      expect(output).toContain("25ms");
    });

    it("renders failed tool call with error message", () => {
      const { lastFrame } = render(
        <ToolExecutionCard
          toolCall={{
            id: "2",
            name: "run_command",
            target: "npm test",
            status: "error",
            error: "exit code 1"
          }}
        />
      );
      const output = lastFrame() || "";
      expect(output).toContain("Exec");
      expect(output).toContain("npm test");
      expect(output).toContain("exit code 1");
    });
  });

  describe("ToolExecutionGroup rendering", () => {
    it("renders small list without outer rail", () => {
      const { lastFrame } = render(
        <ToolExecutionGroup
          toolCalls={[
            { id: "1", name: "read_file", target: "a.ts", status: "success" },
            { id: "2", name: "edit_file", target: "b.ts", status: "success" }
          ]}
        />
      );
      const output = lastFrame() || "";
      expect(output).toContain("Read");
      expect(output).toContain("Edit");
      expect(output).not.toContain("┌");
    });

    it("renders rail and summary for 3+ tool calls", () => {
      const { lastFrame } = render(
        <ToolExecutionGroup
          toolCalls={[
            { id: "1", name: "read_file", target: "a.ts", status: "success" },
            { id: "2", name: "edit_file", target: "b.ts", status: "success" },
            { id: "3", name: "run_command", target: "npm test", status: "success", durationMs: 1200 }
          ]}
        />
      );
      const output = lastFrame() || "";
      expect(output).toContain("3 tool calls");
      expect(output).toContain("3 succeeded");
      expect(output).toContain("┌");
      expect(output).toContain("│");
      expect(output).toContain("└");
    });
  });
});
