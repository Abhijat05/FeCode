import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TurnView } from "./TurnView.js";

describe("TurnView Component", () => {
  it("renders prompt, response, and thinking summary cleanly", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="hello agent"
        response="hello user"
        status="done"
        thinkingMs={1200}
        thinkingTokens={50}
        thinkingSummary="Analyzing project files"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("hello agent");
    expect(frame).toContain("hello user");
    expect(frame).toContain("Thought for 1.2s, 50 tokens");
    expect(frame).toContain("Analyzing project files");
  });

  it("renders cancelled badge when status is cancelled", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="run build"
        response="Build failed"
        status="cancelled"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⊘ Cancelled");
  });

  it("renders separator between turns when isLast is false", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="first"
        response="first response"
        status="done"
        isLast={false}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("────");
  });

  it("scales separator past 80 columns up to 120 columns on wide viewports", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="wide"
        response="wide response"
        status="done"
        isLast={false}
        columns={95}
      />
    );
    const frame = lastFrame() ?? "";
    // Separator should scale to 93 columns (95 - 2), exceeding the old 80 cap
    expect(frame).toContain("─".repeat(93));
  });

  it("renders structured tool call cards when toolCalls are provided", () => {
    const { lastFrame } = render(
      <TurnView
        prompt="modify file"
        response="Done modifying"
        status="done"
        toolCalls={[
          {
            id: "t1",
            name: "read_file",
            target: "src/App.tsx",
            status: "success",
            durationMs: 15
          },
          {
            id: "t2",
            name: "edit_file",
            target: "src/App.tsx",
            status: "success",
            durationMs: 40
          }
        ]}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Read");
    expect(frame).toContain("src/App.tsx");
    expect(frame).toContain("Edit");
    expect(frame).toContain("15ms");
    expect(frame).toContain("Done modifying");
  });
});

