import type { ButtonProps } from "../../../components/ui/button";
import { blendHex, colors } from "../../../theme/colors";

export const CONTROL_RADIUS = 6;

export function panelBorder(): string {
  return blendHex(colors.border, colors.borderFocused, 0.18);
}

export function panelFill(): string {
  return blendHex(colors.panel, colors.bg, 0.22);
}

export function subtlePanelFill(): string {
  return blendHex(colors.panel, colors.bg, 0.42);
}

export function selectedPanelFill(): string {
  return blendHex(colors.selected, colors.bg, 0.42);
}

export function controlBorderColor(focused = false, active = false): string {
  if (active) return colors.borderFocused;
  if (focused) return blendHex(colors.borderFocused, colors.textBright, 0.24);
  return panelBorder();
}

export function controlShadow(active = false): string {
  return active
    ? `0 0 0 1px ${blendHex(colors.bg, colors.borderFocused, 0.18)}, inset 0 1px 0 ${blendHex(colors.bg, colors.textBright, 0.06)}`
    : `inset 0 1px 0 ${blendHex(colors.bg, colors.textBright, 0.04)}`;
}

export function buttonPalette(props: Pick<ButtonProps, "variant" | "active" | "disabled">) {
  if (props.disabled) {
    return {
      fg: colors.textMuted,
      bg: subtlePanelFill(),
      border: panelBorder(),
    };
  }
  if (props.active) {
    return {
      fg: colors.selectedText,
      bg: colors.selected,
      border: colors.borderFocused,
    };
  }

  switch (props.variant) {
    case "primary":
      return {
        fg: colors.bg,
        bg: colors.borderFocused,
        border: colors.borderFocused,
      };
    case "danger":
      return {
        fg: colors.bg,
        bg: colors.negative,
        border: colors.negative,
      };
    case "ghost":
      return {
        fg: colors.textDim,
        bg: "transparent",
        border: panelBorder(),
      };
    case "secondary":
    default:
      return {
        fg: colors.text,
        bg: panelFill(),
        border: panelBorder(),
      };
  }
}
