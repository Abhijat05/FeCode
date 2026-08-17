import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import * as fs from "fs/promises";
import {
  DefaultSessionStore,
  SessionHistoryFormatter,
  type Agent,
  type ProjectContext,
  type SessionStore,
  type PersistedSessionData,
  type SessionStatus,
  type TaskCompletionSummary
} from "@fecode/agent";
import type { ApprovalRequest, ModelMessage } from "@fecode/models";
import {
  InteractiveApprovalResolver,
  formatApprovalArguments,
  formatApprovalRequest
} from "./approvalResolver.js";

export interface Turn {
  id: string;
  prompt: string;
  response: string;
  status: "thinking" | "streaming" | "done" | "error" | "cancelled";
  error?: string;
}

export interface AppProps {
  agent?: Agent;
  cwd?: string;
  providerName?: string;
  modelName?: string;
  approvalResolver?: InteractiveApprovalResolver;
  onExit?: () => void;
  configError?: string;
  projectContext?: ProjectContext;
  sessionStore?: SessionStore;
  initialSessionData?: PersistedSessionData;
}

export const App: React.FC<AppProps> = ({
  agent,
  cwd = process.cwd(),
  providerName,
  modelName,
  approvalResolver,
  onExit,
  configError,
  projectContext,
  sessionStore,
  initialSessionData
}) => {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [store] = useState<SessionStore>(
    () => sessionStore || new DefaultSessionStore()
  );
  const [sessionId, setSessionId] = useState<string>(
    () =>
      initialSessionData?.sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  );
  const [taskCount, setTaskCount] = useState<number>(
    () => initialSessionData?.taskCount || 0
  );
  const [completedSummaries, setCompletedSummaries] = useState<
    TaskCompletionSummary[]
  >(() => initialSessionData?.completedTaskSummaries || []);
  const [lastTaskStatus, setLastTaskStatus] = useState<SessionStatus>(
    () => initialSessionData?.status || "idle"
  );
  const [activeRequest, setActiveRequest] = useState<string | undefined>(
    undefined
  );
  const startedAtRef = React.useRef<Date>(
    initialSessionData?.startedAt
      ? new Date(initialSessionData.startedAt)
      : new Date()
  );

  const [turns, setTurns] = useState<Turn[]>(() => {
    if (initialSessionData) {
      return [
        {
          id: `init-${Date.now()}`,
          prompt: `--resume ${initialSessionData.sessionId}`,
          response: SessionHistoryFormatter.formatResumeSummary(
            initialSessionData
          ),
          status: "done"
        }
      ];
    }
    return [];
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(
    null
  );
  const [approvalInput, setApprovalInput] = useState("");

  const persistState = useCallback(
    async (
      status: SessionStatus,
      newSummary?: TaskCompletionSummary,
      explicitTaskCount?: number
    ) => {
      try {
        const summaries = newSummary
          ? [...completedSummaries, newSummary]
          : completedSummaries;
        if (newSummary) {
          setCompletedSummaries(summaries);
        }
        const state = (
          agent as { getState?: () => { messages?: ModelMessage[] } }
        )?.getState?.();
        const messages = state?.messages || [];
        await store.save({
          version: 1,
          sessionId,
          workingDirectory: cwd,
          provider: providerName || "unknown",
          model: modelName || "unknown",
          startedAt: startedAtRef.current.toISOString(),
          updatedAt: new Date().toISOString(),
          taskCount:
            explicitTaskCount !== undefined ? explicitTaskCount : taskCount,
          status,
          completedTaskSummaries: summaries,
          messages
        });
      } catch {
        // Silently catch persistence error
      }
    },
    [
      store,
      sessionId,
      cwd,
      providerName,
      modelName,
      taskCount,
      completedSummaries,
      agent
    ]
  );

  const handleExit = useCallback(() => {
    persistState(lastTaskStatus).catch(() => {});
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit, persistState, lastTaskStatus]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        if (pendingApproval) {
          if (approvalResolver) {
            approvalResolver.cancelPending("Approval request cancelled via Ctrl+C");
          }
          setPendingApproval(null);
          setApprovalInput("");
          return;
        }

        if (isGenerating && agent) {
          agent.cancel().catch(() => {});
          setIsGenerating(false);
          setLastTaskStatus("cancelled");
          setActiveRequest(undefined);

          const cancelledSummary: TaskCompletionSummary = {
            taskIndex: taskCount,
            request: activeRequest || "Task",
            status: "cancelled",
            completedFiles: [],
            verifiedCommands: [],
            completedRequirements: [],
            remainingRequirements: []
          };
          setCompletedSummaries((prev) => [...prev, cancelledSummary]);
          persistState("cancelled", cancelledSummary).catch(() => {});

          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            updated[lastIndex] = {
              ...updated[lastIndex],
              status: "cancelled",
              error: "Generation cancelled."
            };
            return updated;
          });
        } else {
          handleExit();
        }
      }
    },
    { isActive: true }
  );

  const handleApprovalSubmit = (value: string) => {
    const trimmed = value.trim();
    setApprovalInput("");
    setPendingApproval(null);
    if (approvalResolver) {
      approvalResolver.submitDecision(trimmed);
    }
  };

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;

    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/help") {
        setQuery("");
        const helpText =
          `Available commands:\n` +
          `  /help                - Show available FeCode commands\n` +
          `  /status              - Show current session information\n` +
          `  /history             - Show recent session task history\n` +
          `  /tasks               - List summary of session tasks\n` +
          `  /task [number]       - Show current task or details of a specific task\n` +
          `  /sessions            - List saved sessions\n` +
          `  /resume <sessionId>  - Resume a saved session\n` +
          `  /delete-session <id> - Delete a saved session\n` +
          `  /clear               - Clear conversation context while preserving history\n` +
          `  /exit                - Cleanly terminate the session\n`;
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: helpText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/status") {
        const completedCount = completedSummaries.filter(
          (s) => s.status === "completed"
        ).length;
        const blockedCount = completedSummaries.filter(
          (s) => s.status === "blocked"
        ).length;
        const lastSummary =
          completedSummaries.length > 0
            ? completedSummaries[completedSummaries.length - 1]
            : undefined;
        const statusText = SessionHistoryFormatter.formatSessionStatus({
          sessionId,
          workingDirectory: cwd,
          provider: providerName || "unknown",
          model: modelName || "unknown",
          taskCount,
          completedCount,
          blockedCount,
          currentStatus: lastTaskStatus,
          lastChangeSet: lastSummary?.changeSet
        });
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: statusText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/history") {
        setQuery("");
        const historyText = SessionHistoryFormatter.formatHistory(
          completedSummaries
        );
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: historyText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/tasks") {
        setQuery("");
        const tasksText = SessionHistoryFormatter.formatTaskList(
          completedSummaries
        );
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: tasksText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/task") {
        setQuery("");
        const targetNumStr = parts[1];
        if (targetNumStr) {
          const num = parseInt(targetNumStr, 10);
          if (isNaN(num) || num < 1 || num > completedSummaries.length) {
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Task not found: ${targetNumStr}\n`,
                status: "done"
              }
            ]);
            return;
          }
          const taskDetail = SessionHistoryFormatter.formatTaskDetail(
            completedSummaries[num - 1],
            num
          );
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: taskDetail,
              status: "done"
            }
          ]);
          return;
        }

        let currentDetail = "";
        if (isGenerating) {
          currentDetail = SessionHistoryFormatter.formatCurrentTask(
            {
              status: "in_progress",
              completedFiles: [],
              verifiedCommands: [],
              completedRequirements: [],
              remainingRequirements: [],
              request: activeRequest
            },
            activeRequest
          );
        } else {
          currentDetail = SessionHistoryFormatter.formatCurrentTask(null);
        }
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: currentDetail,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/sessions") {
        setQuery("");
        try {
          const summaries = await store.list();
          const text = SessionHistoryFormatter.formatSessionsList(summaries);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: text,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Failed to list sessions: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/resume") {
        setQuery("");
        const targetId = parts[1];
        if (!targetId) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "✗ Please specify a sessionId: /resume <sessionId>\n",
              status: "done"
            }
          ]);
          return;
        }

        try {
          const loaded = await store.load(targetId);
          try {
            await fs.stat(loaded.workingDirectory);
          } catch {
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `⚠ Working directory no longer exists\n\nPath:\n  ${loaded.workingDirectory}\n`,
                status: "done"
              }
            ]);
            return;
          }

          setSessionId(loaded.sessionId);
          setTaskCount(loaded.taskCount);
          setCompletedSummaries(loaded.completedTaskSummaries || []);
          setLastTaskStatus(loaded.status);
          if (agent?.restoreSession) {
            agent.restoreSession(loaded);
          }

          const resumeSummary =
            SessionHistoryFormatter.formatResumeSummary(loaded);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: resumeSummary,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/delete-session") {
        setQuery("");
        const targetId = parts[1];
        if (!targetId) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response:
                "✗ Please specify a sessionId: /delete-session <sessionId>\n",
              status: "done"
            }
          ]);
          return;
        }

        try {
          const deleted = await store.delete(targetId);
          if (deleted) {
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✓ Deleted session: ${targetId}\n`,
                status: "done"
              }
            ]);
          } else {
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Session not found: ${targetId}\n`,
                status: "done"
              }
            ]);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Failed to delete session: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/clear") {
        setQuery("");
        if (agent?.clear) {
          agent.clear();
        }
        setTurns([
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response:
              "✓ Conversation cleared\n\n" +
              "Session history remains available through:\n" +
              "  /history\n" +
              "  /tasks\n",
            status: "done"
          }
        ]);
        setLastTaskStatus("idle");
        persistState("idle").catch(() => {});
        return;
      }

      if (cmd === "/exit" || cmd === "/quit") {
        setQuery("");
        handleExit();
        return;
      }

      setQuery("");
      setTurns((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          prompt: trimmed,
          response: `✗ Unknown command: ${cmd}. Type /help for available commands.\n`,
          status: "done"
        }
      ]);
      return;
    }

    setQuery("");
    setIsGenerating(true);
    const nextTaskCount = taskCount + 1;
    setTaskCount(nextTaskCount);
    setActiveRequest(trimmed);
    setLastTaskStatus("in_progress");

    const turnId = `turn-${Date.now()}`;
    const newTurn: Turn = {
      id: turnId,
      prompt: trimmed,
      response: "",
      status: "thinking"
    };

    setTurns((prev) => [...prev, newTurn]);

    if (!agent) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "error",
                error: configError || "Agent runtime is not configured."
              }
            : t
        )
      );
      setIsGenerating(false);
      return;
    }

    const toolCallNames = new Map<string, string>();

    try {
      const stream = agent.run({ message: trimmed, cwd });
      for await (const event of stream) {
        if (event.type === "text") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + event.content
                  }
                : t
            )
          );
        } else if (event.type === "skills_activated" && "skills" in event) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + `\n● Using skills: ${event.skills.join(", ")}\n`
                  }
                : t
            )
          );
        } else if (event.type === "tool_call") {
          toolCallNames.set(event.call.id, event.call.name);
          let toolIndicator = `● ${event.call.name}`;
          if (event.call.name === "search_files") {
            toolIndicator = "● Exploring...";
          } else if (event.call.name === "read_file") {
            toolIndicator = "● Inspecting...";
          } else if (
            event.call.name === "write_file" ||
            event.call.name === "edit_file"
          ) {
            toolIndicator = "● Implementing...";
          } else if (event.call.name === "execute_command") {
            toolIndicator = "● Verifying...";
          }

          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + `\n${toolIndicator}\n`
                  }
                : t
            )
          );
        } else if (event.type === "approval_required") {
          setPendingApproval(event.request);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response:
                      t.response +
                      `● approval required for ${event.request.toolName}\n`
                  }
                : t
            )
          );
        } else if (event.type === "tool_result") {
          setPendingApproval(null);
          const toolName = toolCallNames.get(event.callId) || "tool";
          let statusLine = "";
          if (event.result.success) {
            statusLine = `✓ ${toolName}\n\n`;
          } else {
            const err = event.result.error;
            if (err?.code === "NOT_FOUND") {
              statusLine = `⚠ ${toolName}: File not found — searching again\n\n`;
            } else if (err?.code === "EDIT_CONFLICT") {
              statusLine = `⚠ ${toolName}: Edit conflict — refreshing file context\n\n`;
            } else if (err?.code === "REPEATED_CALL_LOOP") {
              statusLine = `⚠ ${toolName}: Repeated call loop detected — adapting strategy\n\n`;
            } else if (err?.code === "PERMISSION_DENIED") {
              statusLine = `✗ ${toolName}: Permission denied (${err.message})\n\n`;
            } else {
              statusLine = `✗ ${toolName} failed: ${err?.message || "denied"}\n\n`;
            }
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + statusLine
                  }
                : t
            )
          );
        } else if (event.type === "plan_created") {
          const planText =
            `\n● Plan: ${event.plan.goal}\n\n` +
            event.plan.steps
              .map((s, i) => `  ${i + 1}. ${s.description}`)
              .join("\n") +
            "\n\n";
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + planText
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_started") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + `● Step ${event.stepIndex + 1}\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_completed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + `✓ Step ${event.stepIndex + 1} completed\n\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_failed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response:
                      t.response +
                      `✗ Step ${event.stepIndex + 1} failed${event.error ? `: ${event.error}` : ""}\n\n`
                  }
                : t
            )
          );
        } else if (event.type === "task_summary") {
          const fullSummary: TaskCompletionSummary = {
            ...event.summary,
            taskIndex: nextTaskCount,
            request: trimmed
          };
          setLastTaskStatus(fullSummary.status);
          setCompletedSummaries((prev) => {
            const filtered = prev.filter((p) => p.taskIndex !== nextTaskCount);
            return [...filtered, fullSummary];
          });
          persistState(fullSummary.status, fullSummary, nextTaskCount).catch(() => {});

          let summaryText = "";
          if (fullSummary.status === "completed") {
            if (fullSummary.isNoOp) {
              summaryText =
                "\n✓ No changes needed\n\nThe requested behavior is already implemented.\n";
            } else {
              summaryText = "\n✓ Task completed\n";
              if (fullSummary.request) {
                summaryText += `\nRequest:\n  ${fullSummary.request}\n`;
              }
              if (fullSummary.fileChanges && fullSummary.fileChanges.length > 0) {
                summaryText += `\nChanged:\n${fullSummary.fileChanges.map((fc) => `  ${fc.path.padEnd(36)} +${fc.additions} -${fc.deletions}`).join("\n")}\n`;
              } else if (fullSummary.completedFiles.length > 0) {
                summaryText += `\nChanged:\n${fullSummary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
              }
              if (fullSummary.verifiedCommands.length > 0) {
                summaryText += `\nVerified:\n${fullSummary.verifiedCommands.map((c) => `  ${c}`).join("\n")}\n`;
              }
            }
          } else if (fullSummary.status === "blocked") {
            summaryText = "\n⚠ Task blocked\n";
            if (fullSummary.request) {
              summaryText += `\nRequest:\n  ${fullSummary.request}\n`;
            }
            if (fullSummary.completedRequirements.length > 0) {
              summaryText += `\nCompleted:\n${fullSummary.completedRequirements.map((r) => `  ✓ ${r}`).join("\n")}\n`;
            }
            if (fullSummary.remainingRequirements.length > 0) {
              summaryText += `\nRemaining:\n${fullSummary.remainingRequirements.map((r) => `  ⚠ ${r}`).join("\n")}\n`;
            }
            if (fullSummary.blockedReason) {
              summaryText += `\nReason:\n  ${fullSummary.blockedReason}\n`;
            }
            if (fullSummary.fileChanges && fullSummary.fileChanges.length > 0) {
              summaryText += `\nChanged:\n${fullSummary.fileChanges.map((fc) => `  ${fc.path.padEnd(36)} +${fc.additions} -${fc.deletions}`).join("\n")}\n`;
            } else if (fullSummary.completedFiles.length > 0) {
              summaryText += `\nChanged:\n${fullSummary.completedFiles.map((f) => `  ${f}`).join("\n")}\n`;
            }
          }
          if (summaryText) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      status: "streaming",
                      response: t.response + summaryText
                    }
                  : t
              )
            );
          }
        } else if (event.type === "done") {
          setPendingApproval(null);
          setIsGenerating(false);
          setActiveRequest(undefined);
          setLastTaskStatus((prev) => (prev === "in_progress" ? "completed" : prev));
          persistState("completed").catch(() => {});
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, status: "done" } : t
            )
          );
        } else if (event.type === "error") {
          setPendingApproval(null);
          setIsGenerating(false);
          setActiveRequest(undefined);
          setLastTaskStatus("blocked");
          persistState("blocked").catch(() => {});
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "error",
                    error: event.error.message
                  }
                : t
            )
          );
        }
      }
    } catch (err: unknown) {
      setPendingApproval(null);
      setIsGenerating(false);
      setActiveRequest(undefined);
      setLastTaskStatus("blocked");
      persistState("blocked").catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "error",
                error: message
              }
            : t
        )
      );
    } finally {
      setPendingApproval(null);
      setIsGenerating(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        FeCode
      </Text>
      <Box marginY={1} flexDirection="column">
        {providerName && <Text color="gray">Provider: {providerName}</Text>}
        {modelName && <Text color="gray">Model: {modelName}</Text>}
        <Text color="gray">Working directory:</Text>
        <Text>{cwd}</Text>
        {projectContext && (
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Detected:</Text>
            {projectContext.projectType && projectContext.projectType !== "unknown" && (
              <Text>  Type: {projectContext.projectType}</Text>
            )}
            {projectContext.languages.length > 0 && (
              <Text>  Languages: {projectContext.languages.join(", ")}</Text>
            )}
            {projectContext.frameworks.length > 0 && (
              <Text>  Frameworks: {projectContext.frameworks.join(", ")}</Text>
            )}
            {projectContext.styling.length > 0 && (
              <Text>  Styling: {projectContext.styling.join(", ")}</Text>
            )}
            {projectContext.packageManager && (
              <Text>  Package Manager: {projectContext.packageManager}</Text>
            )}
            {projectContext.testing.length > 0 && (
              <Text>  Testing: {projectContext.testing.join(", ")}</Text>
            )}

            {(projectContext.structure.sourceDirectories.length > 0 || projectContext.structure.componentDirectories.length > 0 || projectContext.structure.routeDirectories.length > 0 || projectContext.structure.testDirectories.length > 0) && (
              <Box marginTop={1} flexDirection="column">
                <Text color="gray">Structure:</Text>
                {projectContext.structure.sourceDirectories.length > 0 && (
                  <Text>  Source: {projectContext.structure.sourceDirectories.map(d => d + "/").join(", ")}</Text>
                )}
                {projectContext.structure.componentDirectories.length > 0 && (
                  <Text>  Components: {projectContext.structure.componentDirectories.map(d => d + "/").join(", ")}</Text>
                )}
                {projectContext.structure.routeDirectories.length > 0 && (
                  <Text>  Routes: {projectContext.structure.routeDirectories.map(d => d + "/").join(", ")}</Text>
                )}
                {projectContext.structure.testDirectories.length > 0 && (
                  <Text>  Tests: {projectContext.structure.testDirectories.map(d => d + "/").join(", ")}</Text>
                )}
              </Box>
            )}
          </Box>
        )}
      </Box>

      {configError && (
        <Box marginY={1}>
          <Text color="red">✗ {configError}</Text>
        </Box>
      )}

      {turns.map((turn) => (
        <Box key={turn.id} flexDirection="column" marginY={1}>
          <Text color="yellow">› {turn.prompt}</Text>
          {turn.status === "thinking" && !turn.response && (
            <Text color="gray">● Thinking...</Text>
          )}
          {turn.response ? <Text>{turn.response}</Text> : null}
          {turn.status === "error" && (
            <Text color="red">✗ {turn.error || "Request failed."}</Text>
          )}
          {turn.status === "cancelled" && (
            <Text color="yellow">Generation cancelled.</Text>
          )}
        </Box>
      ))}

      {pendingApproval && (
        <Box
          flexDirection="column"
          marginY={1}
          borderStyle="round"
          borderColor="yellow"
          padding={1}
        >
          {pendingApproval.changeReview ? (
            <Box flexDirection="column">
              <Text color="cyan">
                {formatApprovalRequest(pendingApproval)}
              </Text>
            </Box>
          ) : (
            <Box marginY={1} flexDirection="column">
              <Text bold color="yellow">
                {pendingApproval.toolName === "execute_command"
                  ? "⚠ FeCode wants to run a command"
                  : "⚠ FeCode wants to use a tool"}
              </Text>
              <Box marginY={1} flexDirection="column">
                <Text>
                  <Text color="gray">Tool:</Text> {pendingApproval.toolName}
                </Text>
                <Text>
                  <Text color="gray">Category:</Text> {pendingApproval.category}
                </Text>
                {pendingApproval.reason && (
                  <Text>
                    <Text color="gray">Reason:</Text> {pendingApproval.reason}
                  </Text>
                )}
                <Text>
                  <Text color="gray">Arguments:</Text>
                </Text>
                <Text color="cyan">
                  {formatApprovalArguments(pendingApproval.arguments)}
                </Text>
              </Box>
            </Box>
          )}
          <Box marginTop={1}>
            <Text bold color="yellow">
              Allow? [y/N]:{" "}
            </Text>
            <TextInput
              value={approvalInput}
              onChange={setApprovalInput}
              onSubmit={handleApprovalSubmit}
            />
          </Box>
        </Box>
      )}

      {!isGenerating && !pendingApproval && (
        <Box marginTop={1}>
          <Text color="yellow">› </Text>
          <TextInput value={query} onChange={setQuery} onSubmit={handleSubmit} />
        </Box>
      )}
    </Box>
  );
};
