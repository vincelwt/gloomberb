import { Box, Text, useUiHost } from "../ui";
import { TextAttributes } from "../ui";
import { colors } from "../theme/colors";
import { ListView, type ListRowState, type ListViewItem } from "./ui/list-view";

export interface ToggleListItem {
  id: string;
  label: string;
  enabled: boolean;
  description?: string;
  disabled?: boolean;
}

export interface ToggleListProps {
  items: ToggleListItem[];
  selectedIdx: number;
  onToggle?: (id: string) => void;
  onSelect?: (idx: number) => void;
  /** Background color for non-selected rows (defaults to colors.bg) */
  bgColor?: string;
  height?: number;
  flexGrow?: number;
  scrollable?: boolean;
  showSelectedDescription?: boolean;
  rowIdPrefix?: string;
  rowGap?: number;
  rowHeight?: number;
  surface?: "framed" | "plain";
}

function DesktopToggleRow({
  item,
  state,
  rowIdPrefix,
  enabled,
}: {
  item: ListViewItem;
  state: ListRowState;
  rowIdPrefix?: string;
  enabled: boolean;
}) {
  const checkboxBorder = enabled
    ? colors.borderFocused
    : state.selected
    ? colors.textMuted
    : colors.border;
  const textColor = state.disabled
    ? colors.textMuted
    : state.selected
    ? colors.text
    : colors.textDim;

  return (
    <Box
      id={rowIdPrefix ? `${rowIdPrefix}:${item.id}` : undefined}
      flexDirection="row"
      alignItems="center"
      width="100%"
      minWidth={0}
      style={{
        height: "100%",
        gap: 10,
        paddingInline: 10,
        opacity: state.disabled ? 0.55 : 1,
      }}
    >
      <Box
        alignItems="center"
        justifyContent="center"
        backgroundColor={enabled ? colors.borderFocused : "transparent"}
        style={{
          width: 16,
          height: 16,
          minWidth: 16,
          alignSelf: "center",
          border: `1px solid ${checkboxBorder}`,
          borderRadius: 4,
          boxShadow: enabled
            ? "inset 0 1px 0 rgba(255,255,255,0.28)"
            : "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {enabled && (
          <Text
            fg={colors.bg}
            attributes={TextAttributes.BOLD}
            style={{ fontSize: 12, lineHeight: "14px", fontWeight: 800 }}
          >
            {"✓"}
          </Text>
        )}
      </Box>
      <Box minWidth={0} flexShrink={1}>
        <Text
          fg={textColor}
          attributes={state.selected ? TextAttributes.BOLD : 0}
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: state.selected ? 700 : 500,
            lineHeight: "16px",
          }}
        >
          {item.label}
        </Text>
      </Box>
    </Box>
  );
}

export function ToggleList({
  items,
  selectedIdx,
  onToggle,
  onSelect,
  bgColor,
  height,
  flexGrow,
  scrollable,
  showSelectedDescription = true,
  rowIdPrefix,
  rowGap,
  rowHeight,
  surface,
}: ToggleListProps) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const listItems: ListViewItem[] = items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    disabled: item.disabled,
  }));

  return (
    <ListView
      items={listItems}
      selectedIndex={selectedIdx}
      bgColor={bgColor ?? colors.bg}
      showSelectedDescription={showSelectedDescription}
      height={height}
      flexGrow={flexGrow}
      scrollable={scrollable}
      rowGap={rowGap ?? (isDesktopWeb ? 0 : undefined)}
      rowHeight={rowHeight}
      surface={surface}
      onSelect={onSelect}
      onActivate={(item) => {
        onToggle?.(item.id);
      }}
      renderRow={(item, state, index) => {
        const toggleItem = items.find((entry) => entry.id === item.id);
        if (isDesktopWeb) {
          return (
            <DesktopToggleRow
              item={item}
              state={state}
              rowIdPrefix={rowIdPrefix}
              enabled={toggleItem?.enabled === true}
            />
          );
        }

        const checked = toggleItem?.enabled ? "\u2713" : " ";
        const activate = (event: any) => {
          event.stopPropagation?.();
          if (state.disabled) return;
          onSelect?.(index);
          onToggle?.(item.id);
        };
        return (
          <Box
            id={rowIdPrefix ? `${rowIdPrefix}:${item.id}` : undefined}
            flexDirection="row"
            onMouseDown={activate}
          >
            <Text fg={state.selected ? colors.selectedText : colors.textDim}>
              {state.selected ? "\u25b8 " : "  "}
            </Text>
            <Text
              fg={state.selected ? colors.text : colors.textDim}
              attributes={state.selected ? TextAttributes.BOLD : 0}
              onMouseDown={activate}
            >
              {`[${checked}] ${item.label}`}
            </Text>
          </Box>
        );
      }}
    />
  );
}
