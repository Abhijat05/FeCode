import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Agent } from "@fecode/agent";

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
  onExit?: () => void;
  configError?: string;
}

export const App: React.FC<AppProps> = ({
  agent,
  cwd = process.cwd(),
  onExit,
  configError
}) => {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

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
        } else if (event.type === "tool_result") {
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
                        : `✗ ${toolName} failed\n\n`)
                  }
                : t
            )
          );
        } else if (event.type === "done") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, status: "done" } : t
            )
          );
        } else if (event.type === "error") {
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
      setIsGenerating(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        FeCode
      </Text>
      <Box marginY={1} flexDirection="column">
        <Text color="gray">Working directory:</Text>
        <Text>{cwd}</Text>
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

      {!isGenerating && (
        <Box marginTop={1}>
          <Text color="yellow">› </Text>
          <TextInput value={query} onChange={setQuery} onSubmit={handleSubmit} />
        </Box>
      )}
    </Box>
  );
};
