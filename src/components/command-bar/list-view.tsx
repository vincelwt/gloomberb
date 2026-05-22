import { memo, useMemo, type RefObject } from "react";
import {
  Box,
  Input,
  ScrollBox,
  Text,
  TextAttributes,
  type ScrollBoxRenderable,
} from "../../ui";
import { Spinner } from "../ui";
import type { CommandBarListRow, ListScreenState, ResultItem } from "./list-model";
import { getRowPresentation, truncateText } from "./view-model";

export type CommandBarListScrollEvent = {
  stopPropagation: () => void;
  preventDefault: () => void;
  scroll?: { direction?: string; delta?: number };
};

interface CommandBarListHeaderProps {
  kind: ListScreenState["kind"];
  query: string;
  queryDisplayWidth: number;
  nativePaneChrome: boolean;
  inputBg: string;
  paletteBg: string;
  paletteText: string;
  paletteSubtleText: string;
  cursorColor: string;
  contentPadding: number;
  rootGhostSuffix: string | null;
  rootQueryLength: number;
  rootShortcutFeedback: string | null;
  onQueryChange: (query: string) => void;
}

export const CommandBarListHeader = memo(function CommandBarListHeader({
  kind,
  query,
  queryDisplayWidth,
  nativePaneChrome,
  inputBg,
  paletteBg,
  paletteText,
  paletteSubtleText,
  cursorColor,
  contentPadding,
  rootGhostSuffix,
  rootQueryLength,
  rootShortcutFeedback,
  onQueryChange,
}: CommandBarListHeaderProps) {
  return (
    <>
      <Box height={1} paddingX={contentPadding}>
        <Box
          width={queryDisplayWidth}
          height={1}
          position="relative"
          backgroundColor={nativePaneChrome ? undefined : inputBg}
          style={nativePaneChrome ? undefined : {
            overflow: "hidden",
          }}
        >
          <Input
            value={query}
            onInput={onQueryChange}
            onChange={onQueryChange}
            placeholder={kind === "root" ? "Search" : "Filter"}
            focused
            width={nativePaneChrome ? "100%" : queryDisplayWidth}
            backgroundColor={nativePaneChrome ? "transparent" : paletteBg}
            focusedBackgroundColor={nativePaneChrome ? "transparent" : paletteBg}
            textColor={paletteText}
            focusedTextColor={paletteText}
            placeholderColor={paletteSubtleText}
            cursorColor={cursorColor}
          />
          {kind === "root" && rootGhostSuffix && (
            <Box
              position="absolute"
              top={0}
              left={Math.max(0, Math.min(rootQueryLength, queryDisplayWidth - 1))}
              width={Math.max(0, queryDisplayWidth - Math.min(rootQueryLength, queryDisplayWidth - 1))}
              height={1}
            >
              <Text fg={paletteSubtleText}>
                {truncateText(
                  rootGhostSuffix,
                  Math.max(0, queryDisplayWidth - Math.min(rootQueryLength, queryDisplayWidth - 1)),
                )}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
      <Box height={1} paddingX={contentPadding}>
        {kind === "root" && rootShortcutFeedback
          ? (
            <Text fg={paletteSubtleText}>
              {truncateText(rootShortcutFeedback, queryDisplayWidth)}
            </Text>
          )
          : null}
      </Box>
    </>
  );
});

interface CommandBarListItemRowProps {
  item: ResultItem;
  globalIdx: number;
  isSelected: boolean;
  isHovered: boolean;
  contentPadding: number;
  labelWidth: number;
  trailingWidth: number;
  nativePaneChrome: boolean;
  paletteBg: string;
  paletteHoverBg: string;
  paletteSelectedBg: string;
  paletteSelectedText: string;
  paletteSubtleText: string;
  paletteText: string;
  panelBg: string;
  onHoverIndex: (index: number | null) => void;
  onListScroll: (event: CommandBarListScrollEvent) => void;
  onRowMouseDown: (event: any, item: ResultItem, globalIdx: number) => void;
}

const CommandBarListItemRow = memo(function CommandBarListItemRow({
  item,
  globalIdx,
  isSelected,
  isHovered,
  contentPadding,
  labelWidth,
  trailingWidth,
  nativePaneChrome,
  paletteBg,
  paletteHoverBg,
  paletteSelectedBg,
  paletteSelectedText,
  paletteSubtleText,
  paletteText,
  panelBg,
  onHoverIndex,
  onListScroll,
  onRowMouseDown,
}: CommandBarListItemRowProps) {
  const presentation = getRowPresentation(item, isSelected, trailingWidth > 0);
  const label = truncateText(presentation.label, labelWidth);
  const trailing = truncateText(presentation.trailing, trailingWidth);

  return (
    <Box
      key={item.id}
      flexDirection="row"
      height={1}
      paddingX={contentPadding}
      backgroundColor={isSelected
        ? paletteSelectedBg
        : isHovered
          ? paletteHoverBg
          : (nativePaneChrome ? panelBg : paletteBg)}
      onMouseMove={() => onHoverIndex(globalIdx)}
      onMouseOut={() => onHoverIndex(null)}
      {...(!nativePaneChrome ? { onMouseScroll: onListScroll } : {})}
      onMouseDown={(event: any) => onRowMouseDown(event, item, globalIdx)}
      data-command-bar-row-selected={nativePaneChrome && isSelected ? "true" : undefined}
      style={nativePaneChrome ? { borderRadius: 6 } : undefined}
    >
      <Box width={labelWidth}>
        <Text fg={isSelected ? paletteSelectedText : presentation.primaryMuted ? paletteSubtleText : paletteText}>
          {label}
        </Text>
      </Box>
      <Box width={trailingWidth}>
        <Text fg={isSelected ? paletteSelectedText : paletteSubtleText}>{trailing}</Text>
      </Box>
    </Box>
  );
});

interface CommandBarListBodyProps {
  visibleListState: ListScreenState;
  nativeListRows: CommandBarListRow[];
  listBodyHeight: number;
  contentPadding: number;
  labelWidth: number;
  nativePaneChrome: boolean;
  nativeListScrollRef: RefObject<ScrollBoxRenderable | null>;
  paletteBg: string;
  paletteHeadingText: string;
  paletteHoverBg: string;
  paletteSelectedBg: string;
  paletteSelectedText: string;
  paletteSubtleText: string;
  paletteText: string;
  panelBg: string;
  queryDisplayWidth: number;
  trailingWidth: number;
  onHoverIndex: (index: number | null) => void;
  onListScroll: (event: CommandBarListScrollEvent) => void;
  onRowMouseDown: (event: any, item: ResultItem, globalIdx: number) => void;
}

export const CommandBarListBody = memo(function CommandBarListBody({
  visibleListState,
  nativeListRows,
  listBodyHeight,
  contentPadding,
  labelWidth,
  nativePaneChrome,
  nativeListScrollRef,
  paletteBg,
  paletteHeadingText,
  paletteHoverBg,
  paletteSelectedBg,
  paletteSelectedText,
  paletteSubtleText,
  paletteText,
  panelBg,
  queryDisplayWidth,
  trailingWidth,
  onHoverIndex,
  onListScroll,
  onRowMouseDown,
}: CommandBarListBodyProps) {
  const visibleRows = useMemo(() => {
    const rows = nativeListRows;
    if (nativePaneChrome) return rows;
    const paddedRows = [...rows];
    while (paddedRows.length < listBodyHeight) {
      paddedRows.push({ kind: "filler", id: `filler:${paddedRows.length}` });
    }
    return paddedRows;
  }, [
    listBodyHeight,
    nativeListRows,
    nativePaneChrome,
  ]);

  const renderedRows = (
    <>
      {visibleRows.map((row) => {
        if (row.kind === "filler" || row.kind === "spacer") {
          return <Box key={row.id} height={1} />;
        }
        if (row.kind === "spinner") {
          return (
            <Box key={row.id} height={1} paddingX={contentPadding} {...(!nativePaneChrome ? { onMouseScroll: onListScroll } : {})}>
              <Spinner label={row.label} />
            </Box>
          );
        }
        if (row.kind === "message") {
          return (
            <Box key={row.id} height={1} paddingX={contentPadding} {...(!nativePaneChrome ? { onMouseScroll: onListScroll } : {})}>
              <Text fg={paletteText}>{truncateText(row.label, queryDisplayWidth)}</Text>
            </Box>
          );
        }
        if (row.kind === "heading") {
          return (
            <Box key={row.id} height={1} paddingX={contentPadding} {...(!nativePaneChrome ? { onMouseScroll: onListScroll } : {})}>
              <Text attributes={TextAttributes.BOLD} fg={paletteHeadingText}>
                {truncateText(row.label, queryDisplayWidth)}
              </Text>
            </Box>
          );
        }

        const isSelected = row.globalIdx === visibleListState.selectedIdx;
        const isHovered = row.globalIdx === visibleListState.hoveredIdx && !isSelected;
        const itemRowKey = `item:${row.globalIdx}:${row.item.id}:${row.item.category}:${row.item.label}:${row.item.right || ""}`;
        return (
          <CommandBarListItemRow
            key={itemRowKey}
            item={row.item}
            globalIdx={row.globalIdx}
            isSelected={isSelected}
            isHovered={isHovered}
            contentPadding={contentPadding}
            labelWidth={labelWidth}
            trailingWidth={trailingWidth}
            nativePaneChrome={nativePaneChrome}
            paletteBg={paletteBg}
            paletteHoverBg={paletteHoverBg}
            paletteSelectedBg={paletteSelectedBg}
            paletteSelectedText={paletteSelectedText}
            paletteSubtleText={paletteSubtleText}
            paletteText={paletteText}
            panelBg={panelBg}
            onHoverIndex={onHoverIndex}
            onListScroll={onListScroll}
            onRowMouseDown={onRowMouseDown}
          />
        );
      })}
    </>
  );

  return (
    <ScrollBox
      ref={nativeListScrollRef}
      flexDirection="column"
      height={listBodyHeight}
      scrollY
      focusable={false}
      {...(!nativePaneChrome ? { onMouseScroll: onListScroll } : {})}
    >
      {renderedRows}
    </ScrollBox>
  );
});
