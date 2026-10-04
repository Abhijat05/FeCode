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
});
