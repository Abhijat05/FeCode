import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { HelpView } from "./HelpView.js";

describe("HelpView", () => {
  it("renders bounded within 17 rows at standard 80x24 terminal", () => {
    const { lastFrame } = render(<HelpView terminalColumns={80} terminalRows={24} />);
    const frame = lastFrame() || "";
    const lineCount = frame.split("\n").length;

    // Previous implementation was 33 rows tall; must now strictly fit in <= 18 rows
    expect(lineCount).toBeLessThanOrEqual(18);
    expect(frame).toContain("Available Commands:");
    expect(frame).toContain("Keyboard Shortcuts:");
    expect(frame).toContain("/help");
    expect(frame).toContain("/plan");
    expect(frame).toContain("/runs");
    expect(frame).toContain("/exit");
    expect(frame).toContain("Ctrl+C");
    expect(frame).toContain("Esc");
  });

  it("paginates commands cleanly when terminal rows < 24 to prevent scrollback leak", () => {
    const { lastFrame } = render(<HelpView terminalColumns={80} terminalRows={20} />);
    const frame = lastFrame() || "";
    const lineCount = frame.split("\n").length;

    // Must be tightly bounded to <= 13 rows to leave room for Header, Input, and StatusBar
    expect(lineCount).toBeLessThanOrEqual(13);
    expect(frame).toContain("Page 1 of 2");
    expect(frame).toContain("/help");
    expect(frame).toContain("Keyboard Shortcuts:");
  });

  it("renders single column layout with pagination for narrow terminals (<75 cols)", () => {
    const { lastFrame } = render(<HelpView terminalColumns={60} terminalRows={24} />);
    const frame = lastFrame() || "";
    const lineCount = frame.split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(14);
    expect(frame).toContain("Page 1 of");
    expect(frame).toContain("/help");
  });

  it("renders compact single-line shortcuts footer when terminal height is < 18 rows", () => {
    const { lastFrame } = render(<HelpView terminalColumns={80} terminalRows={16} />);
    const frame = lastFrame() || "";
    const lineCount = frame.split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(11);
    expect(frame).toContain("Ctrl+C");
    expect(frame).toContain("Esc");
  });

  it("allows navigating between pages using arrow keys and p/n input", async () => {
    const { lastFrame, stdin } = render(<HelpView terminalColumns={80} terminalRows={20} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain("Page 1 of 2");
    expect(lastFrame()).toContain("/help");

    stdin.write("\u001B[B");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain("Page 2 of 2");
    expect(lastFrame()).toContain("/exit");

    stdin.write("\u001B[A");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain("Page 1 of 2");
    expect(lastFrame()).toContain("/help");
  });
});
