import { describe, it, expect } from "vitest";
import {
  SessionHistoryFormatter,
  formatTimeRelative
} from "./historyFormatter.js";
import type { TaskCompletionSummary } from "../completion/types.js";
import type { PersistedSessionData } from "./types.js";

describe("SessionHistoryFormatter — Phase 5C", () => {
  it("formats empty history gracefully", () => {
    const output = SessionHistoryFormatter.formatHistory([]);
    expect(output).toContain("Session History");
    expect(output).toContain("No task history available.");
  });

  it("formats completed, blocked, and cancelled tasks in reverse chronological order", () => {
    const tasks: TaskCompletionSummary[] = [
      {
        taskIndex: 1,
        request: "Add login validation",
        status: "completed",
        completedFiles: ["src/components/LoginForm.tsx"],
        verifiedCommands: ["npm test"],
        completedRequirements: ["Validate email format"],
        remainingRequirements: []
      },
      {
        taskIndex: 2,
        request: "Add loading state",
        status: "completed",
        completedFiles: ["src/components/LoginForm.tsx"],
        verifiedCommands: [],
        completedRequirements: [],
        remainingRequirements: []
      },
      {
        taskIndex: 3,
        request: "Fix authentication tests",
        status: "blocked",
        blockedReason: "Verification failed after maximum attempts",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: [],
        remainingRequirements: ["Authentication integration tests"]
      },
      {
        taskIndex: 4,
        request: "Add dark mode",
        status: "cancelled",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: ["Theme context"],
        remainingRequirements: ["Toggle button"]
      }
    ];

    const history = SessionHistoryFormatter.formatHistory(tasks);
    expect(history).toContain("Session History");
    // Newest task (Task 4) first
    expect(history).toMatch(/4\.\s+⚠\s+Add dark mode[\s\S]*3\.\s+⚠\s+Fix authentication tests[\s\S]*2\.\s+✓\s+Add loading state[\s\S]*1\.\s+✓\s+Add login validation/);
    expect(history).toContain("Changed: src/components/LoginForm.tsx");
    expect(history).toContain("Verified: npm test");
    expect(history).toContain("Verification failed after maximum attempts");
  });

  it("truncates changed files when exceeding limit", () => {
    const task: TaskCompletionSummary = {
      taskIndex: 1,
      request: "Large refactor",
      status: "completed",
      completedFiles: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts"
      ],
      verifiedCommands: ["npm test"],
      completedRequirements: [],
      remainingRequirements: []
    };

    const history = SessionHistoryFormatter.formatHistory([task], {
      maxChangedFiles: 3
    });
    expect(history).toContain("src/a.ts, src/b.ts, src/c.ts, +2 more");
  });

  it("redacts secrets in task requests and blocker descriptions", () => {
    const task: TaskCompletionSummary = {
      taskIndex: 1,
      request: "Use OPENAI_API_KEY=sk-abcdef1234567890abcdef1234567890 to test",
      status: "blocked",
      blockedReason: "Failed connecting with AIzaSyD1234567890abcdef1234567890abcde",
      completedFiles: [],
      verifiedCommands: [],
      completedRequirements: [],
      remainingRequirements: []
    };

    const history = SessionHistoryFormatter.formatHistory([task]);
    expect(history).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(history).not.toContain("AIzaSyD1234567890abcdef1234567890abcde");
    expect(history).toContain("[REDACTED_SECRET]");
  });

  it("limits history to default 20 items and displays count indicator", () => {
    const tasks: TaskCompletionSummary[] = Array.from({ length: 25 }, (_, i) => ({
      taskIndex: i + 1,
      request: `Task ${i + 1}`,
      status: "completed",
      completedFiles: [],
      verifiedCommands: [],
      completedRequirements: [],
      remainingRequirements: []
    }));

    const history = SessionHistoryFormatter.formatHistory(tasks, { limit: 20 });
    expect(history).toContain("Showing 20 of 25 tasks");
    expect(history).toContain("25. ✓ Task 25");
    expect(history).not.toContain("5. ✓ Task 5");
  });

  it("formats task list for /tasks command", () => {
    const tasks: TaskCompletionSummary[] = [
      {
        taskIndex: 1,
        request: "Add login validation",
        status: "completed",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: [],
        remainingRequirements: []
      },
      {
        taskIndex: 2,
        request: "Fix authentication tests",
        status: "blocked",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: [],
        remainingRequirements: []
      },
      {
        taskIndex: 3,
        request: "Implement OAuth",
        status: "in_progress",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: [],
        remainingRequirements: []
      }
    ];

    const list = SessionHistoryFormatter.formatTaskList(tasks);
    expect(list).toContain("Tasks");
    expect(list).toContain("✓ 1  Add login validation");
    expect(list).toContain("⚠ 2  Fix authentication tests");
    expect(list).toContain("● 3  Implement OAuth");
  });

  it("formats detailed task view for /task <number>", () => {
    const task: TaskCompletionSummary = {
      taskIndex: 2,
      request: "Add loading state",
      status: "completed",
      completedFiles: ["src/components/LoginForm.tsx"],
      verifiedCommands: ["npm test"],
      completedRequirements: [],
      remainingRequirements: []
    };

    const detail = SessionHistoryFormatter.formatTaskDetail(task, 2);
    expect(detail).toContain("Task 2");
    expect(detail).toContain("Status:\n  completed");
    expect(detail).toContain("Request:\n  Add loading state");
    expect(detail).toContain("Changed:\n  src/components/LoginForm.tsx");
    expect(detail).toContain("Verification:\n  npm test");
  });

  it("formats current task view for /task", () => {
    const idleDetail = SessionHistoryFormatter.formatCurrentTask(null);
    expect(idleDetail).toContain("Current Task");
    expect(idleDetail).toContain("No active task.");

    const activeDetail = SessionHistoryFormatter.formatCurrentTask(
      {
        status: "in_progress",
        completedFiles: [],
        verifiedCommands: [],
        completedRequirements: ["Validation schema"],
        remainingRequirements: ["Add tests"]
      },
      "Add validation to the login form"
    );

    expect(activeDetail).toContain("Current Task");
    expect(activeDetail).toContain("Status:\n  in_progress");
    expect(activeDetail).toContain("Request:\n  Add validation to the login form");
    expect(activeDetail).toContain("Completed:\n  ✓ Validation schema");
    expect(activeDetail).toContain("Remaining:\n  ⚠ Add tests");
  });

  it("formats session status for /status command", () => {
    const statusText = SessionHistoryFormatter.formatSessionStatus({
      sessionId: "session-a1b2",
      workingDirectory: "D:\\projects\\shop",
      provider: "gemini",
      model: "gemini-2.5-flash",
      taskCount: 4,
      completedCount: 3,
      blockedCount: 1,
      currentStatus: "idle"
    });

    expect(statusText).toContain("FeCode");
    expect(statusText).toContain("Provider:\n  gemini");
    expect(statusText).toContain("Model:\n  gemini-2.5-flash");
    expect(statusText).toContain("Working directory:\n  D:\\projects\\shop");
    expect(statusText).toContain("Session:\n  session-a1b2");
    expect(statusText).toContain("Tasks:\n  4");
    expect(statusText).toContain("Completed:\n  3");
    expect(statusText).toContain("Blocked:\n  1");
    expect(statusText).toContain("Current task:\n  idle");
  });

  it("formats resume summary without dumping previous conversations", () => {
    const session: PersistedSessionData = {
      version: 1,
      sessionId: "session-a1b2",
      workingDirectory: "D:\\projects\\shop",
      provider: "gemini",
      model: "gemini-2.5-flash",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      taskCount: 3,
      status: "completed",
      completedTaskSummaries: [
        {
          taskIndex: 1,
          request: "Add login validation",
          status: "completed",
          completedFiles: [],
          verifiedCommands: [],
          completedRequirements: [],
          remainingRequirements: []
        },
        {
          taskIndex: 2,
          request: "Add loading state",
          status: "completed",
          completedFiles: [],
          verifiedCommands: [],
          completedRequirements: [],
          remainingRequirements: []
        },
        {
          taskIndex: 3,
          request: "Fix authentication tests",
          status: "blocked",
          completedFiles: [],
          verifiedCommands: [],
          completedRequirements: [],
          remainingRequirements: []
        }
      ],
      messages: [
        { role: "user", content: "Very long private conversation" },
        { role: "assistant", content: "Very long internal assistant reply" }
      ]
    };

    const summary = SessionHistoryFormatter.formatResumeSummary(session);
    expect(summary).toContain("FeCode");
    expect(summary).toContain("Resumed session");
    expect(summary).toContain("Session:\n  session-a1b2");
    expect(summary).toContain("Working directory:\n  D:\\projects\\shop");
    expect(summary).toContain("Previous tasks:");
    expect(summary).toContain("✓ Add login validation");
    expect(summary).toContain("✓ Add loading state");
    expect(summary).toContain("⚠ Fix authentication tests");
    expect(summary).toContain("3 tasks");
    // Ensure raw conversation messages are NOT dumped
    expect(summary).not.toContain("Very long private conversation");
    expect(summary).not.toContain("Very long internal assistant reply");
  });

  it("formats relative time correctly", () => {
    const now = new Date();
    expect(formatTimeRelative(now.toISOString())).toBe("just now");

    const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
    expect(formatTimeRelative(tenMinsAgo.toISOString())).toBe("10m ago");

    const yesterday = new Date(now.getTime() - 25 * 3600 * 1000);
    expect(formatTimeRelative(yesterday.toISOString())).toBe("yesterday");
  });
});
