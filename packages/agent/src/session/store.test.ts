import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultSessionStore } from "./store.js";
import type { PersistedSessionData } from "./types.js";

describe("DefaultSessionStore — Phase 5B", () => {
  let tempDir: string;
  let store: DefaultSessionStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-session-test-"));
    store = new DefaultSessionStore(tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("saves and loads a session with atomic file creation", async () => {
    const sessionData: PersistedSessionData = {
      version: 1,
      sessionId: "session-12345",
      workingDirectory: "/test/workspace",
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 3,
      status: "completed",
      completedTaskSummaries: [
        {
          status: "completed",
          completedFiles: ["src/App.tsx"],
          verifiedCommands: ["npm test"],
          completedRequirements: ["Update header"],
          remainingRequirements: []
        }
      ],
      messages: [
        { role: "user", content: "Hello FeCode" },
        { role: "assistant", content: "Hello! How can I help you?" }
      ]
    };

    await store.save(sessionData);

    // Verify session JSON exists on disk
    const filePath = path.join(tempDir, "session-12345.json");
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const loaded = await store.load("session-12345");
    expect(loaded.sessionId).toBe("session-12345");
    expect(loaded.workingDirectory).toBe("/test/workspace");
    expect(loaded.provider).toBe("gemini");
    expect(loaded.model).toBe("gemini-2.5-flash");
    expect(loaded.taskCount).toBe(3);
    expect(loaded.status).toBe("completed");
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.completedTaskSummaries).toHaveLength(1);
  });

  it("sanitizes API keys and authorization tokens before persisting", async () => {
    const sessionData: PersistedSessionData = {
      version: 1,
      sessionId: "session-secret-test",
      workingDirectory: "/test/workspace",
      provider: "openai",
      model: "gpt-4o",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      status: "completed",
      completedTaskSummaries: [],
      messages: [
        {
          role: "user",
          content: "Use OPENAI_API_KEY=sk-abcdef1234567890abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiJ9.token"
        },
        {
          role: "assistant",
          content: "Using AIzaSyD1234567890abcdef1234567890abcde for authentication."
        }
      ]
    };

    await store.save(sessionData);

    const rawFile = await fs.readFile(
      path.join(tempDir, "session-secret-test.json"),
      "utf-8"
    );
    expect(rawFile).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(rawFile).not.toContain("AIzaSyD1234567890abcdef1234567890abcde");
    expect(rawFile).toContain("[REDACTED_SECRET]");

    const loaded = await store.load("session-secret-test");
    expect(loaded.messages[0].content).toContain("[REDACTED_SECRET]");
    expect(loaded.messages[1].content).toContain("[REDACTED_SECRET]");
  });

  it("lists all saved sessions sorted by updatedAt descending", async () => {
    const s1: PersistedSessionData = {
      version: 1,
      sessionId: "session-a",
      workingDirectory: "/workspace/a",
      provider: "openai",
      model: "gpt-4o",
      startedAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
      taskCount: 1,
      status: "completed",
      completedTaskSummaries: [],
      messages: []
    };

    const s2: PersistedSessionData = {
      version: 1,
      sessionId: "session-b",
      workingDirectory: "/workspace/b",
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: "2026-01-01T11:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
      taskCount: 5,
      status: "in_progress",
      completedTaskSummaries: [],
      messages: []
    };

    await store.save(s1);
    await store.save(s2);

    const list = await store.list();
    expect(list).toHaveLength(2);
    // session-b was updated later
    expect(list[0].sessionId).toBe("session-b");
    expect(list[0].taskCount).toBe(5);
    expect(list[1].sessionId).toBe("session-a");
  });

  it("deletes a saved session", async () => {
    const sessionData: PersistedSessionData = {
      version: 1,
      sessionId: "session-to-delete",
      workingDirectory: "/workspace",
      provider: "ollama",
      model: "llama3",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 1,
      status: "idle",
      completedTaskSummaries: [],
      messages: []
    };

    await store.save(sessionData);
    expect(await store.delete("session-to-delete")).toBe(true);
    expect(await store.delete("session-to-delete")).toBe(false);

    await expect(store.load("session-to-delete")).rejects.toThrow("Session not found");
  });

  it("throws clear error when session is missing", async () => {
    await expect(store.load("nonexistent-session")).rejects.toThrow(
      "Session not found: nonexistent-session"
    );
  });

  it("throws clear error when session JSON is corrupted", async () => {
    const corruptPath = path.join(tempDir, "corrupt-sess.json");
    await fs.writeFile(corruptPath, "{ invalid json content ...", "utf-8");

    await expect(store.load("corrupt-sess")).rejects.toThrow(
      "Session data is corrupted."
    );
  });

  it("throws clear error when session schema version is unsupported", async () => {
    const futurePath = path.join(tempDir, "future-sess.json");
    await fs.writeFile(
      futurePath,
      JSON.stringify({ version: 99, sessionId: "future-sess" }),
      "utf-8"
    );

    await expect(store.load("future-sess")).rejects.toThrow(
      "Unsupported session schema version: 99"
    );
  });

  it("rejects path traversal in session IDs", async () => {
    await expect(store.load("../outside")).rejects.toThrow("Invalid sessionId");
    await expect(
      store.save({
        version: 1,
        sessionId: "../../malicious",
        workingDirectory: "/test",
        provider: "test",
        model: "test",
        startedAt: "",
        updatedAt: "",
        taskCount: 0,
        status: "idle",
        completedTaskSummaries: [],
        messages: []
      })
    ).rejects.toThrow("Invalid sessionId");
  });
});
