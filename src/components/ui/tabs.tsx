import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, useUiHost } from "../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";

export interface TabItem {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeValue: string;
  onSelect: (value: string) => void;
  compact?: boolean;
}

const WHEEL_DELTA_PER_CELL = 8;

export function Tabs({ tabs, activeValue, onSelect, compact = false }: TabsProps) {
  const ui = useUiHost();
  const NativeTabs = ui.Tabs;
  const palette = {
    activeFg: colors.text,
    inactiveFg: colors.textDim,
    disabledFg: colors.textMuted,
    hoverFg: colors.text,
    activeUnderline: colors.borderFocused,
    inactiveUnderline: colors.bg,
    hoverUnderline: colors.border,
    hoverBg: hoverBg(),
  };

  if (NativeTabs) {
    return (
      <NativeTabs
        tabs={tabs}
        activeValue={activeValue}
        onSelect={onSelect}
        compact={compact}
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
      palette={palette}
    />
  );
}

function OpenTuiTabs({
  tabs,
  activeValue,
  onSelect,
  compact = false,
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
  };
}) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const tabWidths = useMemo(
    () => tabs.map((tab) => tab.label.length + 2),
    [tabs],
  );
  const totalWidth = tabWidths.reduce((sum, width) => sum + width, 0);

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
          const tabLabel = ` ${tab.label} `;
          const attributes = (active ? TextAttributes.BOLD : 0)
            | (!compact && (active || hovered) ? TextAttributes.UNDERLINE : 0);
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
              backgroundColor={hovered ? palette.hoverBg : undefined}
              onMouseOver={startHover}
              onMouseMove={startHover}
              onMouseOut={endHover}
              onMouseDown={tab.disabled ? undefined : (event) => {
                event.preventDefault();
                onSelect(tab.value);
              }}
            >
              <Text
                fg={tab.disabled ? palette.disabledFg : active ? palette.activeFg : hovered ? palette.hoverFg : palette.inactiveFg}
                attributes={attributes}
              >
                {tabLabel}
              </Text>
            </Box>
          );
        })}
      </Box>
    </ScrollBox>
  );
}
