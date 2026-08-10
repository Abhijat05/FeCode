import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface AppProps {
  cwd?: string;
  onExit?: () => void;
}

export const App: React.FC<AppProps> = ({ cwd = process.cwd() }) => {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setHistory((prev) => [...prev, trimmed]);
    setQuery("");
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
      {history.map((item, index) => (
        <Box key={index} marginY={0}>
          <Text color="green">{`> ${item}`}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="yellow">&gt; </Text>
        <TextInput value={query} onChange={setQuery} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
};
