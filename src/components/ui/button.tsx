import { Box, Text, useUiHost } from "../../ui";
import { TextAttributes } from "../../ui";
import { type ComponentType } from "react";
import { colors } from "../../theme/colors";
import { t } from "../../i18n";
import { useRemoteUiNode } from "../../remote/semantic-tree";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  active?: boolean;
  shortcut?: string;
  width?: number;
  height?: number | string;
}

function resolveButtonColors(variant: ButtonVariant, active: boolean, disabled: boolean) {
  if (disabled) {
    return { bg: colors.panel, fg: colors.textMuted };
  }
  if (active) {
    return { bg: colors.selected, fg: colors.selectedText };
  }

  switch (variant) {
    case "primary":
      return { bg: colors.borderFocused, fg: colors.bg };
    case "danger":
      return { bg: colors.negative, fg: colors.bg };
    case "ghost":
      return { bg: colors.bg, fg: colors.textDim };
    case "secondary":
    default:
      return { bg: colors.panel, fg: colors.text };
  }
}

export function Button({
  label: rawLabel,
  onPress,
  variant = "secondary",
  disabled = false,
  active = false,
  shortcut,
  width,
  height,
}: ButtonProps) {
  const label = t(rawLabel);
  useRemoteUiNode({
    role: "button",
    label,
    disabled,
    actions: {
      press: () => {
        if (!disabled) onPress?.();
      },
    },
    metadata: { variant, active, shortcut },
  });
  const HostButton = useUiHost().Button as ComponentType<ButtonProps> | undefined;
  if (HostButton) {
    return (
      <HostButton
        label={label}
        onPress={onPress}
        variant={variant}
        disabled={disabled}
        active={active}
        shortcut={shortcut}
        width={width}
        height={height}
      />
    );
  }

  const palette = resolveButtonColors(variant, active, disabled);

  return (
    <Box
      width={width}
      height={height ?? 1}
      flexDirection="row"
      backgroundColor={palette.bg}
      onMouseDown={() => {
        if (!disabled) onPress?.();
      }}
    >
      <Text fg={palette.fg} attributes={active ? TextAttributes.BOLD : 0}>
        {` ${label} `}
      </Text>
      {shortcut && (
        <Text fg={disabled ? colors.textMuted : colors.textDim}>
          {` ${shortcut}`}
        </Text>
      )}
    </Box>
  );
}
