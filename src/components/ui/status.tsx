import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";

export type StatusTone = "info" | "success" | "warning" | "danger" | "muted";

function toneColors(tone: StatusTone) {
  switch (tone) {
    case "success":
      return { fg: colors.positive, bg: colors.bg };
    case "warning":
      return { fg: "#f6c65b", bg: colors.bg };
    case "danger":
      return { fg: colors.negative, bg: colors.bg };
    case "muted":
      return { fg: colors.textMuted, bg: colors.bg };
    case "info":
    default:
      return { fg: colors.textBright, bg: colors.bg };
  }
}

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

export function StatusBadge({ label, tone = "info" }: StatusBadgeProps) {
  const palette = toneColors(tone);
  return (
    <box backgroundColor={palette.bg}>
      <text fg={palette.fg}>{` ${label} `}</text>
    </box>
  );
}

export interface NoticeProps {
  title?: string;
  message: string;
  tone?: StatusTone;
}

export function Notice({ title, message, tone = "info" }: NoticeProps) {
  const palette = toneColors(tone);

  return (
    <box flexDirection="column">
      {title && (
        <box height={1}>
          <text fg={palette.fg} attributes={TextAttributes.BOLD}>{title}</text>
        </box>
      )}
      <box height={1}>
        <text fg={tone === "muted" ? colors.textDim : colors.text}>{message}</text>
      </box>
    </box>
  );
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.textDim}>{title}</text>
      </box>
      {message && (
        <box height={1}>
          <text fg={colors.textMuted}>{message}</text>
        </box>
      )}
      {hint && (
        <box height={1}>
          <text fg={colors.textMuted}>{hint}</text>
        </box>
      )}
    </box>
  );
}
