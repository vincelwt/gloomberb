import { useRef } from "react";
import { TextAttributes, type BoxRenderable } from "@opentui/core";
import { TabBar } from "../../components";
import { usePredictionMarketsController } from "./controller";
import { PredictionMarketDetailPane } from "./detail/pane";
import { BROWSE_TABS, VENUE_TABS } from "./navigation";
import { PredictionMarketsTable } from "./table";
import { PREDICTION_CATEGORY_OPTIONS } from "./categories";
import type { PredictionBrowseTab, PredictionCategoryId } from "./types";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function PredictionMarketsPane({ focused, width, height }: PaneProps) {
  const controller = usePredictionMarketsController({ focused });
  const rootRef = useRef<BoxRenderable>(null);
  const splitDragRef = useRef<{ startX: number; startRatio: number } | null>(
    null,
  );
  const minTableWidth = 44;
  const minDetailWidth = 36;
  const effectiveMinTableWidth = controller.selectedSummary
    ? Math.min(minTableWidth, Math.max(width - minDetailWidth - 1, 20))
    : width;
  const effectiveMinDetailWidth = controller.selectedSummary
    ? Math.min(minDetailWidth, Math.max(width - effectiveMinTableWidth - 1, 20))
    : 0;
  const listWidth = controller.selectedSummary
    ? clamp(
        Math.round(width * controller.detailSplitRatio),
        effectiveMinTableWidth,
        Math.max(effectiveMinTableWidth, width - effectiveMinDetailWidth - 1),
      )
    : width;
  const detailWidth = controller.selectedSummary
    ? Math.max(width - listWidth - 1, effectiveMinDetailWidth)
    : 0;
  const dividerColor =
    controller.focusRegion === "detail" ? colors.borderFocused : colors.border;

  const handlePaneMouse = (event: {
    type?: string;
    x?: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (!controller.selectedSummary || !rootRef.current) {
      splitDragRef.current = null;
      return;
    }

    const localX = (event.x ?? 0) - rootRef.current.x;
    const dividerX = listWidth;

    if (
      event.type === "down" &&
      localX >= dividerX &&
      localX <= dividerX + 1
    ) {
      splitDragRef.current = {
        startX: localX,
        startRatio: controller.detailSplitRatio,
      };
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    if (!splitDragRef.current) return;

    if (event.type === "drag") {
      const delta = localX - splitDragRef.current.startX;
      const nextListWidth = clamp(
        Math.round(width * splitDragRef.current.startRatio) + delta,
        effectiveMinTableWidth,
        Math.max(effectiveMinTableWidth, width - effectiveMinDetailWidth - 1),
      );
      controller.actions.setDetailSplitRatio(nextListWidth / Math.max(width, 1));
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    if (event.type === "up" || event.type === "drag-end") {
      splitDragRef.current = null;
      event.preventDefault?.();
      event.stopPropagation?.();
    }
  };

  return (
    <box
      ref={rootRef}
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.panel}
      onMouse={handlePaneMouse}
    >
      {!controller.paneSettings.hideTabs && (
        <TabBar
          tabs={VENUE_TABS.map((tab) => ({
            label: tab.label,
            value: tab.value,
          }))}
          activeValue={controller.effectiveVenueScope}
          onSelect={controller.actions.setVenue}
          compact
        />
      )}

      <box flexDirection="row" height={1} paddingX={1} gap={2}>
        <box
          flexDirection="row"
          onMouseDown={controller.actions.focusSearch}
          width={Math.max(18, Math.floor(width * 0.32))}
        >
          <text fg={colors.textDim}>
            {controller.searchFocused ? "?" : "/"}
          </text>
          <box width={1} />
          {controller.searchFocused ? (
            <input
              ref={controller.searchInputRef}
              value={controller.searchQuery}
              focused={focused}
              placeholder="search markets"
              placeholderColor={colors.textDim}
              textColor={colors.text}
              backgroundColor={colors.panel}
              flexGrow={1}
              onInput={controller.actions.setSearchQuery}
              onChange={controller.actions.setSearchQuery}
              onSubmit={controller.actions.blurSearch}
            />
          ) : (
            <box flexGrow={1}>
              <text
                fg={
                  controller.searchQuery.trim().length > 0
                    ? colors.text
                    : colors.textDim
                }
              >
                {controller.searchQuery.trim().length > 0
                  ? controller.searchQuery
                  : "search markets"}
              </text>
            </box>
          )}
        </box>

        <box flexGrow={1}>
          <TabBar
            tabs={BROWSE_TABS.map((tab) => ({
              label: tab.label,
              value: tab.value,
            }))}
            activeValue={controller.browseTab}
            onSelect={(value) =>
              controller.actions.selectBrowseTab(value as PredictionBrowseTab)
            }
            compact
          />
        </box>
      </box>

      {PREDICTION_CATEGORY_OPTIONS.length > 1 && (
        <scrollbox height={1} scrollX focusable={false}>
          <box flexDirection="row" paddingX={1} gap={2}>
            {PREDICTION_CATEGORY_OPTIONS.map((category) => {
              const active = category.id === controller.categoryId;
              return (
                <box
                  key={category.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    controller.actions.selectCategory(
                      category.id as PredictionCategoryId,
                    );
                  }}
                >
                  <text
                    fg={active ? colors.textBright : colors.textDim}
                    attributes={active ? TextAttributes.BOLD : 0}
                  >
                    {category.label}
                  </text>
                </box>
              );
            })}
          </box>
        </scrollbox>
      )}

      {controller.catalogError && (
        <box height={1} paddingX={1}>
          <text fg={colors.negative}>{controller.catalogError}</text>
        </box>
      )}

      <box flexDirection="row" flexGrow={1}>
        <box
          width={listWidth}
          flexDirection="column"
          onMouseDown={controller.actions.focusList}
        >
          <PredictionMarketsTable
            columns={controller.visibleColumns}
            rows={controller.visibleRows}
            selectedRowKey={controller.selectedRow?.key ?? null}
            hoveredIdx={controller.hoveredIdx}
            setHoveredIdx={controller.actions.setHoveredIdx}
            setSelectedRowKey={controller.actions.selectRow}
            watchlist={controller.watchlistSet}
            onToggleWatchlist={controller.actions.toggleWatchlist}
            sortPreference={controller.sortPreference}
            onHeaderClick={controller.actions.handleSortHeaderClick}
            headerScrollRef={controller.headerScrollRef}
            scrollRef={controller.scrollRef}
            syncHeaderScroll={controller.layout.syncHeaderScroll}
            onBodyScrollActivity={controller.layout.onBodyScrollActivity}
          />
        </box>

        {controller.selectedSummary && (
          <>
            <box width={1}>
              <text fg={dividerColor}>│</text>
            </box>

            <box
              width={detailWidth}
              flexDirection="column"
              paddingX={1}
              onMouseDown={controller.actions.focusDetail}
            >
              <PredictionMarketDetailPane
                detail={controller.detail}
                detailError={controller.detailError}
                detailLoadCount={controller.detailLoadCount}
                detailTab={controller.detailTab}
                detailWidth={Math.max(detailWidth - 2, 24)}
                focused={controller.focusRegion === "detail"}
                height={height}
                historyRange={controller.historyRange}
                onDetailTabChange={controller.actions.setDetailTab}
                onHistoryRangeChange={controller.actions.setHistoryRange}
                onPreviewOrder={controller.actions.previewOrder}
                onSelectMarket={controller.actions.selectMarket}
                scrollRef={controller.detailScrollRef}
                selectedRow={controller.selectedRow}
                selectedSummary={controller.selectedSummary}
              />
            </box>
          </>
        )}
      </box>
    </box>
  );
}
