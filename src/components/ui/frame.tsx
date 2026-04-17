import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import type { ReactNode } from "react";
import { colors } from "../../theme/colors";

export interface SectionProps {
  title?: string;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
          </Box>
          <Box height={1} />
        </>
      )}
      {children}
    </Box>
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
    <Box flexDirection="row" height={1}>
      <Box width={16}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Text fg={valueColor ?? colors.text} attributes={valueAttributes}>{value}</Text>
    </Box>
  );
}

export interface DialogFrameProps {
  title: string;
  children: ReactNode;
  footer?: string;
}

export function DialogFrame({ title, children, footer }: DialogFrameProps) {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text fg={colors.text} attributes={TextAttributes.BOLD}>{title}</Text>
      </Box>
      <Box height={1} />
      {children}
      {footer && (
        <>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textMuted}>{footer}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
