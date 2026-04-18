import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, useUiHost } from "../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";

export interface TabItem {
  label: string;
  value: string;
  disabled?: boolean;
  onClose?: (value: string) => void;
  onDoubleClick?: (value: string) => void;
  onContextMenu?: (value: string, event: any) => void;
}

export interface TabsProps {
  tabs: TabItem[];
  activeValue: string | null;
  onSelect: (value: string) => void;
  compact?: boolean;
  variant?: "underline" | "pill" | "bare";
  closeMode?: "active" | "always";
  addLabel?: string;
  onAdd?: () => void;
}

const WHEEL_DELTA_PER_CELL = 8;

export function Tabs({
  tabs,
  activeValue,
  onSelect,
  compact = false,
  variant = "underline",
  closeMode = "always",
  addLabel = "+",
  onAdd,
}: TabsProps) {
  const ui = useUiHost();
  const NativeTabs = ui.Tabs;
  const palette = {
    activeFg: variant === "bare" ? colors.textBright : colors.text,
    inactiveFg: colors.textDim,
    disabledFg: colors.textMuted,
    hoverFg: colors.text,
    activeUnderline: colors.borderFocused,
    inactiveUnderline: colors.bg,
    hoverUnderline: colors.border,
    hoverBg: hoverBg(),
    activeBg: colors.selected,
    activePillFg: colors.selectedText,
    closeFg: colors.textMuted,
    addFg: colors.textMuted,
  };

  if (NativeTabs) {
    return (
      <NativeTabs
        tabs={tabs}
        activeValue={activeValue}
        onSelect={onSelect}
        compact={compact}
        variant={variant}
        closeMode={closeMode}
        addLabel={addLabel}
        onAdd={onAdd}
        palette={palette}
      />
    );
  }

  return (
    <OpenTuiTabs
      tabs={tabs}
      activeValue={activeValue}
      onSelect={onSelect}
      compact={compact}
      variant={variant}
      closeMode={closeMode}
      addLabel={addLabel}
      onAdd={onAdd}
      palette={palette}
    />
  );
}

function tabWidth(
  tab: TabItem,
  active: boolean,
  closeMode: TabsProps["closeMode"],
): number {
  const showClose = !!tab.onClose && (closeMode === "always" || active);
  return tab.label.length + 2 + (showClose ? 2 : 0);
}

function OpenTuiTabs({
  tabs,
  activeValue,
  onSelect,
  compact = false,
  variant = "underline",
  closeMode = "always",
  addLabel = "+",
  onAdd,
  palette,
}: TabsProps & {
  palette: {
    activeFg: string;
    inactiveFg: string;
    disabledFg: string;
    hoverFg: string;
    activeUnderline: string;
    inactiveUnderline: string;
    hoverUnderline: string;
    hoverBg: string;
    activeBg: string;
    activePillFg: string;
    closeFg: string;
    addFg: string;
  };
}) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const tabWidths = useMemo(
    () => tabs.map((tab) => tabWidth(tab, tab.value === activeValue, closeMode)),
    [activeValue, closeMode, tabs],
  );
  const addWidth = onAdd ? addLabel.length + 2 : 0;
  const totalWidth = tabWidths.reduce((sum, width) => sum + width, 0) + addWidth;

  useEffect(() => {
    const scrollBox = scrollRef.current;
    const activeIndex = tabs.findIndex((tab) => tab.value === activeValue);
    const viewportWidth = scrollBox?.viewport?.width ?? 0;
    if (!scrollBox || activeIndex < 0 || viewportWidth <= 0) return;

    const activeLeft = tabWidths.slice(0, activeIndex).reduce((sum, width) => sum + width, 0);
    const activeRight = activeLeft + tabWidths[activeIndex]!;
    const currentLeft = scrollBox.scrollLeft ?? 0;
    const currentRight = currentLeft + viewportWidth;
    const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);

    if (activeLeft < currentLeft) {
      scrollBox.scrollTo({ x: activeLeft, y: scrollBox.scrollTop });
    } else if (activeRight > currentRight) {
      scrollBox.scrollTo({
        x: Math.min(activeRight - viewportWidth, maxScrollLeft),
        y: scrollBox.scrollTop,
      });
    }
  }, [activeValue, tabWidths, tabs, totalWidth]);

  const handleMouseScroll = (event?: {
    preventDefault?: () => void;
    stopPropagation?: () => void;
    scroll?: { direction?: string; delta?: number };
  }) => {
    const direction = event?.scroll?.direction;
    if (!direction) return;
    const scrollBox = scrollRef.current;
    const viewportWidth = scrollBox?.viewport?.width ?? 0;
    if (!scrollBox || viewportWidth <= 0 || totalWidth <= viewportWidth) return;

    event.preventDefault?.();
    event.stopPropagation?.();

    const rawDelta = Math.abs(event.scroll?.delta ?? 1);
    const deltaCells = Math.max(1, Math.round(rawDelta / WHEEL_DELTA_PER_CELL));
    const directionSign = direction === "right" || direction === "down" ? 1 : -1;
    const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
    const nextLeft = Math.max(
      0,
      Math.min(maxScrollLeft, (scrollBox.scrollLeft ?? 0) + directionSign * deltaCells),
    );
    scrollBox.scrollTo({ x: nextLeft, y: scrollBox.scrollTop });
  };

  return (
    <ScrollBox
      ref={scrollRef}
      width="100%"
      height={1}
      scrollX
      focusable={false}
      horizontalScrollbarOptions={{ visible: false }}
      onMouseScroll={handleMouseScroll}
    >
      <Box flexDirection="row" width={totalWidth} height={1}>
        {tabs.map((tab, index) => {
          const active = tab.value === activeValue;
          const hovered = hoveredValue === tab.value && !tab.disabled;
          const tabWidth = tabWidths[index] ?? tab.label.length + 2;
          const showClose = !!tab.onClose && (closeMode === "always" || active);
          const attributes = (active ? TextAttributes.BOLD : 0)
            | (variant === "underline" && !compact && (active || hovered) ? TextAttributes.UNDERLINE : 0);
          const startHover = tab.disabled
            ? undefined
            : () => {
                setHoveredValue((current) => (current === tab.value ? current : tab.value));
              };
          const endHover = tab.disabled
            ? undefined
            : () => {
                setHoveredValue((current) => (current === tab.value ? null : current));
              };

          return (
            <Box
              key={tab.value}
              width={tabWidth}
              height={1}
              flexDirection="row"
              backgroundColor={active && variant === "pill" ? palette.activeBg : hovered ? palette.hoverBg : undefined}
              onMouseOver={startHover}
              onMouseMove={startHover}
              onMouseOut={endHover}
              onMouseDown={tab.disabled ? undefined : (event) => {
                if ((event as any)?.button === 2 && tab.onContextMenu) {
                  event.preventDefault?.();
                  event.stopPropagation?.();
                  tab.onContextMenu(tab.value, event);
                  return;
                }
                event.preventDefault();
                onSelect(tab.value);
              }}
              onDoubleClick={tab.disabled || !tab.onDoubleClick ? undefined : () => tab.onDoubleClick?.(tab.value)}
            >
              <Text
                fg={tab.disabled ? palette.disabledFg : active && variant === "pill" ? palette.activePillFg : active ? palette.activeFg : hovered ? palette.hoverFg : palette.inactiveFg}
                attributes={attributes}
              >
                {` ${tab.label} `}
              </Text>
              {showClose && (
                <Text
                  fg={active && variant === "pill" ? palette.activePillFg : palette.closeFg}
                  onMouseDown={(event: any) => {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    tab.onClose?.(tab.value);
                  }}
                >
                  {"x "}
                </Text>
              )}
            </Box>
          );
        })}
        {onAdd && (
          <Box
            width={addWidth}
            height={1}
            backgroundColor={hoveredValue === "__add__" ? palette.hoverBg : undefined}
            onMouseMove={() => setHoveredValue((current) => (current === "__add__" ? current : "__add__"))}
            onMouseOut={() => setHoveredValue((current) => (current === "__add__" ? null : current))}
            onMouseDown={(event) => {
              event.preventDefault();
              onAdd();
            }}
          >
            <Text fg={hoveredValue === "__add__" ? palette.hoverFg : palette.addFg}>
              {` ${addLabel} `}
            </Text>
          </Box>
        )}
      </Box>
    </ScrollBox>
  );
}
