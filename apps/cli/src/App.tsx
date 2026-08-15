import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Agent } from "@fecode/agent";
import type { ProjectContext } from "@fecode/agent";
import type { ApprovalRequest } from "@fecode/models";
import {
  InteractiveApprovalResolver,
  formatApprovalArguments
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
}

export const App: React.FC<AppProps> = ({
  agent,
  cwd = process.cwd(),
  providerName,
  modelName,
  approvalResolver,
  onExit,
  configError,
  projectContext
}) => {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [approvalInput, setApprovalInput] = useState("");

  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit]);

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

    setQuery("");
    setIsGenerating(true);

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
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response: t.response + `\n● ${event.call.name}\n`
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
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "streaming",
                    response:
                      t.response +
                      (event.result.success
                        ? `✓ ${toolName}\n\n`
                        : `✗ ${toolName} failed: ${event.result.error?.message || "denied"}\n\n`)
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
        } else if (event.type === "done") {
          setPendingApproval(null);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, status: "done" } : t
            )
          );
        } else if (event.type === "error") {
          setPendingApproval(null);
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
          <Text bold color="yellow">
            ⚠ FeCode wants to use a tool
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
