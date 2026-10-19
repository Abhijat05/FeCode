import React from "react";
import { Box, Text, useStdout } from "ink";

export interface WelcomeViewProps {
  version?: string;
  projectName?: string;
  modelName?: string;
  providerName?: string;
  cwd?: string;
  gitBranch?: string | null;
  columns?: number;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  version = "v1.0.3",
  projectName,
  modelName,
  providerName,
  cwd = process.cwd(),
  gitBranch,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const cols = explicitColumns ?? stdout?.columns ?? 80;

  // Format path with ~ if inside home
  const formatCwd = (dir: string) => {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (home && dir.startsWith(home)) {
        return "~" + dir.slice(home.length);
      }
    } catch {
      // fallback
    }
    return dir;
  };

  const displayModel =
    providerName && modelName
      ? `${providerName}:${modelName}`
      : modelName || providerName || "default";

  // Micro-banner for narrow viewports (< 65 cols)
  if (cols < 65) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text bold color="cyan">
            [FE]
          </Text>
          <Text bold color="white">
            {" "}
            FeCode Agent {version}
          </Text>
          <Text color="gray"> ({displayModel})</Text>
        </Box>
        <Box marginTop={0}>
          <Text color="gray">{formatCwd(cwd)}</Text>
          {gitBranch && (
            <Text color="cyan"> ⎇ {gitBranch}</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Tips: /help · /plan · /git · ?</Text>
        </Box>
      </Box>
    );
  }

  const logoLines = [
    "  ███████╗███████╗",
    "  ██╔════╝██╔════╝",
    "  █████╗  █████╗  ",
    "  ██╔══╝  ██╔══╝  ",
    "  ██║     ███████╗",
    "  ╚═╝     ╚══════╝"
  ];

  const infoLines = [
    <Text key="info-0">
      <Text bold color="white">FeCode Agent </Text>
      <Text color="cyan">{version}</Text>
    </Text>,
    <Text key="info-1" color="gray">
      Autonomous Pair Programmer
    </Text>,
    <Text key="info-2">
      <Text color="gray">Model: </Text>
      <Text color="whiteBright">{displayModel}</Text>
    </Text>,
    <Text key="info-3">
      <Text color="gray">Dir:   </Text>
      <Text color="white">{formatCwd(cwd)}</Text>
      {gitBranch && (
        <Text color="cyan">  ⎇ {gitBranch}</Text>
      )}
    </Text>,
    projectName ? (
      <Text key="info-4">
        <Text color="gray">Proj:  </Text>
        <Text color="white">{projectName}</Text>
      </Text>
    ) : (
      <Text key="info-4" color="gray" dimColor>
        Ready for tasks
      </Text>
    ),
    <Text key="info-5" color="gray" dimColor>
      ───────────────────────────────
    </Text>
  ];

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Side-by-side logo & metadata block */}
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={3}>
          {logoLines.map((line, idx) => (
            <Text key={`logo-${idx}`} color="cyan" bold>
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          {infoLines.map((item, idx) => (
            <Box key={`info-box-${idx}`}>{item}</Box>
          ))}
        </Box>
      </Box>

      {/* Suggested quick actions & tips */}
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" bold>
          Tips:
        </Text>
        <Box marginLeft={1}>
          <Text color="cyan" bold>
            /help
          </Text>
          <Text color="gray">        List commands & shortcuts</Text>
        </Box>
        <Box marginLeft={1}>
          <Text color="cyan" bold>
            /plan
          </Text>
          <Text color="gray">        Generate execution plan before touching code</Text>
        </Box>
        <Box marginLeft={1}>
          <Text color="cyan" bold>
            /git
          </Text>
          <Text color="gray">         Inspect workspace status & modified files</Text>
        </Box>
        <Box marginLeft={1}>
          <Text color="yellow" bold>
            ?
          </Text>
          <Text color="gray">            Quick shortcut palette</Text>
        </Box>
      </Box>
    </Box>
  );
};
