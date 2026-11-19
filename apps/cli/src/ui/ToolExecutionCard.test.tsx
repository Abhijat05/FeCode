import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  ToolExecutionCard,
  ToolExecutionGroup,
  formatToolDuration,
  getCleanToolName,
  summarizeExplorations
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
      expect(getCleanToolName("execute_command")).toBe("Exec");
      expect(getCleanToolName("bash")).toBe("Exec");
      expect(getCleanToolName("exec")).toBe("Exec");
      expect(getCleanToolName("cmd")).toBe("Exec");
      expect(getCleanToolName("search_files")).toBe("Search");
      expect(getCleanToolName("list_directory")).toBe("List");
      expect(getCleanToolName("custom_tool")).toBe("custom_tool");
    });
  });

  describe("summarizeExplorations", () => {
    it("returns null when fewer than 2 tools provided", () => {
      expect(summarizeExplorations([])).toBeNull();
      expect(
        summarizeExplorations([
          { id: "1", name: "read_file", status: "success" }
        ])
      ).toBeNull();
    });

    it("aggregates reads, searches, lists, and total duration", () => {
      const summary = summarizeExplorations([
        { id: "1", name: "read_file", status: "success", durationMs: 10 },
        { id: "2", name: "read_file", status: "success", durationMs: 20 },
        { id: "3", name: "search_files", status: "success", durationMs: 50 },
        { id: "4", name: "list_directory", status: "success", durationMs: 15 }
      ]);
      expect(summary).not.toBeNull();
      expect(summary?.filesRead).toBe(2);
      expect(summary?.searches).toBe(1);
      expect(summary?.dirsListed).toBe(1);
      expect(summary?.totalDurationMs).toBe(95);
      expect(summary?.description).toContain("read 2 files, searched 1 pattern, listed 1 dir");
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

    it("renders rail and summary for 3 tool calls without smart collapsing", () => {
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

    it("smart collapses exploration and spotlights mutations and failures for large tool sequences", () => {
      const toolCalls = [
        { id: "1", name: "read_file", target: "package.json", status: "success" as const, durationMs: 10 },
        { id: "2", name: "read_file", target: "src/index.ts", status: "success" as const, durationMs: 15 },
        { id: "3", name: "search_files", target: "TODO", status: "success" as const, durationMs: 40 },
        { id: "4", name: "edit_file", target: "src/critical.ts", status: "success" as const, durationMs: 25 },
        { id: "5", name: "execute_command", target: "npm test", status: "error" as const, error: "exit code 1", durationMs: 500 }
      ];

      const { lastFrame } = render(
        <ToolExecutionGroup toolCalls={toolCalls} />
      );
      const output = lastFrame() || "";
      // Should show group header
      expect(output).toContain("5 tool calls");
      expect(output).toContain("4 succeeded, 1 failed");

      // Routine reads should be collapsed into single "Explored" line
      expect(output).toContain("Explored");
      expect(output).toContain("read 2 files, searched 1 pattern");

      // Mutation must be highlighted individually
      expect(output).toContain("Edit");
      expect(output).toContain("src/critical.ts");

      // Failure must be spotlighted individually
      expect(output).toContain("Exec");
      expect(output).toContain("npm test");
      expect(output).toContain("exit code 1");
    });

    it("renders all items individually when expanded=true", () => {
      const toolCalls = [
        { id: "1", name: "read_file", target: "package.json", status: "success" as const },
        { id: "2", name: "read_file", target: "src/index.ts", status: "success" as const },
        { id: "3", name: "read_file", target: "tsconfig.json", status: "success" as const },
        { id: "4", name: "read_file", target: "README.md", status: "success" as const }
      ];

      const { lastFrame } = render(
        <ToolExecutionGroup toolCalls={toolCalls} expanded={true} />
      );
      const output = lastFrame() || "";
      expect(output).toContain("package.json");
      expect(output).toContain("src/index.ts");
      expect(output).toContain("tsconfig.json");
      expect(output).toContain("README.md");
      expect(output).not.toContain("Explored");
    });
  });
});
