import React from "react";
import { Box } from "ink";

export interface AppShellProps {
  header?: React.ReactNode;
  children?: React.ReactNode;
  modal?: React.ReactNode;
  footer?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  header,
  children,
  modal,
  footer
}) => {
  return (
    <Box flexDirection="column" padding={0} width="100%">
      {header}
      {children}
      {modal}
      {footer}
    </Box>
  );
};
