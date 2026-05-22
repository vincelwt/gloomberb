import type { ReactNode } from "react";
import { Box } from "../../ui";
import { colors } from "../../theme/colors";

export function getPaneWindowAttributes({
  enabled = true,
  role,
  paneId,
  floating,
  focused,
  windowModeSelected,
  showBorderColor = false,
}: {
  enabled?: boolean;
  role: string;
  paneId?: string;
  floating?: boolean;
  focused: boolean;
  windowModeSelected?: boolean;
  showBorderColor?: boolean;
}): Record<string, unknown> {
  if (!enabled) return {};

  const attributes: Record<string, unknown> = {
    "data-gloom-role": role,
    "data-focused": focused ? "true" : "false",
  };
  if (paneId) attributes["data-gloom-pane-id"] = paneId;
  if (floating != null) attributes["data-floating"] = floating ? "true" : "false";
  if (windowModeSelected != null) {
    attributes["data-window-mode-selected"] = windowModeSelected ? "true" : "false";
  }
  if (showBorderColor) {
    attributes.style = {
      "--pane-border-color": focused || windowModeSelected ? colors.borderFocused : colors.border,
    };
  }
  return attributes;
}

export function PaneBodyFrame({
  layoutProps,
  backgroundColor,
  children,
}: {
  layoutProps: Record<string, unknown>;
  backgroundColor: string;
  children: ReactNode;
}) {
  return (
    <Box {...layoutProps} overflow="hidden" backgroundColor={backgroundColor}>
      {children}
    </Box>
  );
}
