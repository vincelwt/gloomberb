import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  active?: boolean;
  shortcut?: string;
  width?: number;
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
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  active = false,
  shortcut,
  width,
}: ButtonProps) {
  const palette = resolveButtonColors(variant, active, disabled);

  return (
    <box
      width={width}
      height={1}
      flexDirection="row"
      backgroundColor={palette.bg}
      onMouseDown={() => {
        if (!disabled) onPress?.();
      }}
    >
      <text fg={palette.fg} attributes={active ? TextAttributes.BOLD : 0}>
        {` ${label} `}
      </text>
      {shortcut && (
        <text fg={disabled ? colors.textMuted : colors.textDim}>
          {` ${shortcut}`}
        </text>
      )}
    </box>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "label"> {
  icon: string;
  label?: string;
}

export function IconButton({ icon, label, ...props }: IconButtonProps) {
  return <Button label={label ? `${icon} ${label}` : icon} {...props} />;
}
