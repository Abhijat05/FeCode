import { describe, it, expect } from "vitest";
import { AgentSession } from "./session.js";

describe("AgentSession — Phase 5A", () => {
  it("initializes with unique session ID, provider, model, and working directory", () => {
    const session = new AgentSession({
      workingDirectory: "/test/workspace",
      provider: "openai",
      model: "gpt-4o"
    });

    expect(session.sessionId).toMatch(/^session-/);
    expect(session.workingDirectory).toBe("/test/workspace");
    expect(session.provider).toBe("openai");
    expect(session.model).toBe("gpt-4o");
    expect(session.taskCount).toBe(0);
    expect(session.status).toBe("idle");
    expect(session.startedAt).toBeInstanceOf(Date);
  });

  it("accepts custom sessionId and startedAt", () => {
    const customDate = new Date("2026-01-01T00:00:00Z");
    const session = new AgentSession({
      sessionId: "custom-sess-123",
      workingDirectory: "/workspace",
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: customDate
    });

    expect(session.sessionId).toBe("custom-sess-123");
    expect(session.startedAt).toBe(customDate);
  });

  it("tracks task counts and task statuses", () => {
    const session = new AgentSession({
      workingDirectory: "/workspace",
      provider: "ollama",
      model: "llama3"
    });

    expect(session.taskCount).toBe(0);
    session.incrementTaskCount();
    expect(session.taskCount).toBe(1);

    session.setStatus("in_progress");
    expect(session.status).toBe("in_progress");

    session.setStatus("completed");
    expect(session.status).toBe("completed");

    const info = session.getInfo();
    expect(info.taskCount).toBe(1);
    expect(info.status).toBe("completed");
    expect(info.provider).toBe("ollama");
    expect(info.model).toBe("llama3");
    expect(info.workingDirectory).toBe("/workspace");
  });
});
