import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { colors } from "../../theme/colors";

export interface SectionProps {
  title?: string;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <box flexDirection="column">
      {title && (
        <>
          <box height={1}>
            <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</text>
          </box>
          <box height={1} />
        </>
      )}
      {children}
    </box>
  );
}

export interface FieldRowProps {
  label: string;
  value: string;
  valueColor?: string;
  valueAttributes?: number;
}

export function FieldRow({
  label,
  value,
  valueColor,
  valueAttributes = 0,
}: FieldRowProps) {
  return (
    <box flexDirection="row" height={1}>
      <box width={16}>
        <text fg={colors.textDim}>{label}</text>
      </box>
      <text fg={valueColor ?? colors.text} attributes={valueAttributes}>{value}</text>
    </box>
  );
}

export interface DialogFrameProps {
  title: string;
  children: ReactNode;
  footer?: string;
}

export function DialogFrame({ title, children, footer }: DialogFrameProps) {
  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{title}</text>
      </box>
      <box height={1} />
      {children}
      {footer && (
        <>
          <box height={1} />
          <box height={1}>
            <text fg={colors.textMuted}>{footer}</text>
          </box>
        </>
      )}
    </box>
  );
}
