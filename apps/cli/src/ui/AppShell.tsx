import React from "react";
import { Box, useStdout } from "ink";

export type TerminalLayoutMode = "wide" | "medium" | "narrow" | "very_narrow";

export function getTerminalLayout(columns: number = 80): TerminalLayoutMode {
  if (columns >= 100) return "wide";
  if (columns >= 70) return "medium";
  if (columns >= 50) return "narrow";
  return "very_narrow";
}

export function truncateText(str: string, maxLength: number): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.slice(0, Math.max(0, maxLength - 3)) + "...";
}

export interface AppShellProps {
  header?: React.ReactNode;
  children?: React.ReactNode;
  sidebar?: React.ReactNode;
  modal?: React.ReactNode;
  footer?: React.ReactNode;
  columns?: number;
}

export const AppShell: React.FC<AppShellProps> = ({
  header,
  children,
  sidebar,
  modal,
  footer,
  columns: explicitColumns
}) => {
  const { stdout } = useStdout();
  const columns = explicitColumns ?? stdout?.columns ?? 80;
  const layout = getTerminalLayout(columns);

  return (
    <Box flexDirection="column" padding={0} width="100%">
      {header}

      {/* Main body area with responsive layout */}
      {sidebar && layout === "wide" ? (
        <Box flexDirection="row" width="100%">
          <Box width="65%" flexDirection="column" paddingRight={1}>
            {children}
          </Box>
          <Box width="35%" flexDirection="column" paddingLeft={1}>
            {sidebar}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" width="100%">
          {children}
          {sidebar && <Box flexDirection="column" marginTop={1}>{sidebar}</Box>}
        </Box>
      )}

      {modal}
      {footer}
    </Box>
  );
};
