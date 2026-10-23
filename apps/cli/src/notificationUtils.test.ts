import { describe, it, expect, vi } from "vitest";
import {
  notifyTerminal,
  notifyApprovalRequired,
  notifyTaskCompleted
} from "./notificationUtils.js";

describe("notificationUtils", () => {
  it("emits OSC 9 and bell sequences when forced", () => {
    let written = "";
    const mockStream = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written += data;
        return true;
      })
    } as unknown as NodeJS.WriteStream;

    const result = notifyTerminal("Task complete", {
      stream: mockStream,
      force: true
    });

    expect(result).toBe(true);
    expect(written).toBe("\x1b]9;Task complete\x07\x07");
  });

  it("supports selective bell or osc9 emissions", () => {
    let written = "";
    const mockStream = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written += data;
        return true;
      })
    } as unknown as NodeJS.WriteStream;

    // Only bell
    notifyTerminal("Alert", { stream: mockStream, osc9: false, bell: true, force: true });
    expect(written).toBe("\x07");

    written = "";
    // Only OSC 9
    notifyTerminal("Notice", { stream: mockStream, osc9: true, bell: false, force: true });
    expect(written).toBe("\x1b]9;Notice\x07");
  });

  it("formats notifyApprovalRequired correctly", () => {
    let written = "";
    const mockStream = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written += data;
        return true;
      })
    } as unknown as NodeJS.WriteStream;

    notifyApprovalRequired("src/index.ts", { stream: mockStream, force: true });
    expect(written).toContain("FeCode: Approval required for src/index.ts");
    expect(written).toContain("\x1b]9;");
    expect(written).toContain("\x07");
  });

  it("formats notifyTaskCompleted correctly with and without description", () => {
    let written = "";
    const mockStream = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written += data;
        return true;
      })
    } as unknown as NodeJS.WriteStream;

    notifyTaskCompleted(undefined, { stream: mockStream, force: true });
    expect(written).toBe("\x1b]9;FeCode: Task complete\x07\x07");

    written = "";
    notifyTaskCompleted("Build succeeded", { stream: mockStream, force: true });
    expect(written).toBe("\x1b]9;FeCode: Task complete — Build succeeded\x07\x07");
  });

  it("suppresses output in test environment when force is not true", () => {
    const mockStream = {
      isTTY: true,
      write: vi.fn()
    } as unknown as NodeJS.WriteStream;

    const result = notifyTerminal("Test", { stream: mockStream, force: false });
    expect(result).toBe(false);
    expect(mockStream.write).not.toHaveBeenCalled();
  });

  it("sanitizes control characters in messages", () => {
    let written = "";
    const mockStream = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written += data;
        return true;
      })
    } as unknown as NodeJS.WriteStream;

    notifyTerminal("Hello\r\nWorld\x00!", { stream: mockStream, force: true });
    expect(written).toContain("Hello  World !");
  });
});
