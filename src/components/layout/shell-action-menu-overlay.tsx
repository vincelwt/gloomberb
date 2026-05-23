import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { MENU_Z_INDEX, truncateMenuText } from "./shell-menu";

export interface ActionMenuState {
  paneId: string;
  x: number;
  y: number;
  width: number;
  items: Array<{ id: string; label: string; accelerator?: string; action: () => void }>;
}

export function ShellActionMenuOverlay({
  menuState,
  hoveredMenuItemId,
  onClose,
  onHoverItem,
}: {
  menuState: ActionMenuState | null;
  hoveredMenuItemId: string | null;
  onClose: () => void;
  onHoverItem: (itemId: string) => void;
}) {
  if (!menuState) return null;

  return (
    <Box
      position="absolute"
      left={menuState.x}
      top={menuState.y}
      width={menuState.width}
      height={menuState.items.length + 2}
      backgroundColor={colors.panel}
      border
      borderStyle="single"
      borderColor={colors.borderFocused}
      zIndex={MENU_Z_INDEX}
      flexDirection="column"
    >
      {menuState.items.map((item) => {
        const hovered = hoveredMenuItemId === item.id;
        const innerWidth = Math.max(1, menuState.width - 2);
        const accelerator = item.accelerator ?? "";
        const acceleratorWidth = accelerator.length;
        const labelWidth = accelerator ? Math.max(1, innerWidth - acceleratorWidth - 1) : innerWidth;
        const label = truncateMenuText(item.label, labelWidth);
        const spacer = accelerator ? " ".repeat(Math.max(1, innerWidth - label.length - acceleratorWidth)) : "";
        const line = truncateMenuText(`${label}${spacer}${accelerator}`, innerWidth).padEnd(innerWidth, " ");
        return (
          <Box
            key={item.id}
            height={1}
            width={innerWidth}
            backgroundColor={hovered ? colors.selected : colors.panel}
            onMouseMove={() => onHoverItem(item.id)}
            onMouseDown={(mouseEvent: any) => {
              mouseEvent.stopPropagation();
              mouseEvent.preventDefault();
              onClose();
              item.action();
            }}
            data-gloom-interactive="true"
          >
            <Text fg={hovered ? colors.selectedText : colors.text}>
              {line}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
