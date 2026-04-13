import { TextAttributes } from "@opentui/core";
import { DataTableStackView, TabBar } from "../../components";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { PREDICTION_CATEGORY_OPTIONS } from "./categories";
import { usePredictionMarketsController } from "./controller";
import { PredictionMarketDetailPane } from "./detail/pane";
import { getPredictionColumnValue } from "./metrics";
import { BROWSE_TABS, VENUE_TABS } from "./navigation";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionColumnDef,
  PredictionListRow,
} from "./types";

export function PredictionMarketsPane({ focused, width, height }: PaneProps) {
  const controller = usePredictionMarketsController({ focused });
  const catalogStatusColor =
    controller.catalogStatus?.tone === "danger"
      ? colors.negative
      : colors.borderFocused;

  const browseControls = (
    <>
      {!controller.paneSettings.hideTabs ? (
        <TabBar
          tabs={VENUE_TABS.map((tab) => ({
            label: tab.label,
            value: tab.value,
          }))}
          activeValue={controller.effectiveVenueScope}
          onSelect={controller.actions.setVenue}
          compact
        />
      ) : null}

      <box flexDirection="row" height={1} paddingX={1} gap={2}>
        <box
          flexDirection="row"
          onMouseDown={controller.actions.focusSearch}
          width={Math.max(18, Math.floor(width * 0.32))}
        >
          <text fg={colors.textDim}>{controller.searchFocused ? "?" : "/"}</text>
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

      {PREDICTION_CATEGORY_OPTIONS.length > 1 ? (
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
      ) : null}

      {controller.catalogStatus ? (
        <box height={1} paddingX={1} width={width} backgroundColor={colors.panel}>
          <text fg={catalogStatusColor}>{controller.catalogStatus.message}</text>
        </box>
      ) : null}
    </>
  );

  const selectedRowIndex = controller.visibleRows.findIndex(
    (row) => row.key === controller.selectedRow?.key,
  );

  const renderCell = (
    row: PredictionListRow,
    column: PredictionColumnDef,
  ) => {
    const watchlisted = row.watchMarketKeys.some((marketKey) =>
      controller.watchlistSet.has(marketKey),
    );
    const value = getPredictionColumnValue(column, row, watchlisted);
    if (column.id === "watch") {
      return {
        text: value.text,
        color: value.color,
        onMouseDown: (event: any) => {
          event.preventDefault();
          event.stopPropagation?.();
          controller.actions.toggleWatchlist(row);
        },
      };
    }
    return {
      text: value.text,
      color: value.color,
    };
  };

  const detailContent =
    controller.selectedSummary && controller.selectedRow ? (
      <box
        flexDirection="column"
        flexGrow={1}
        width={width}
        height={Math.max(height - 1, 1)}
        paddingX={1}
        backgroundColor={colors.panel}
      >
        <PredictionMarketDetailPane
          detail={controller.detail}
          detailError={controller.detailError}
          detailLoadCount={controller.detailLoadCount}
          detailTab={controller.detailTab}
          detailWidth={Math.max(width - 2, 24)}
          focused={focused && controller.detailOpen}
          height={Math.max(height - 1, 1)}
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
    ) : (
      <box flexGrow={1} backgroundColor={colors.panel} />
    );

  return (
    <DataTableStackView<PredictionListRow, PredictionColumnDef>
      focused={focused}
      keyboardNavigation={!controller.searchFocused}
      detailOpen={controller.detailOpen && !!controller.selectedSummary}
      onBack={controller.actions.closeDetail}
      detailContent={detailContent}
      rootBefore={browseControls}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.panel}
      selectedIndex={selectedRowIndex}
      onSelectIndex={(_index, row) =>
        controller.actions.setBrowseSelection(row.key, {
          debounceDetail: true,
        })}
      onActivateIndex={(_index, row) =>
        controller.actions.openSelectedRow(row.key)}
      columns={controller.visibleColumns}
      items={controller.visibleRows}
      sortColumnId={controller.sortPreference.columnId}
      sortDirection={controller.sortPreference.direction}
      onHeaderClick={controller.actions.handleSortHeaderClick}
      headerScrollRef={controller.headerScrollRef}
      scrollRef={controller.scrollRef}
      hoveredIdx={controller.hoveredIdx}
      setHoveredIdx={controller.actions.setHoveredIdx}
      getItemKey={(row) => row.key}
      isSelected={(row) => controller.selectedRow?.key === row.key}
      onSelect={(row) => controller.actions.setBrowseSelection(row.key)}
      onActivate={(row) => controller.actions.openSelectedRow(row.key)}
      virtualize
      renderCell={renderCell}
      emptyStateTitle="No markets matched."
      emptyStateHint="Change the venue, browse tab, or search query."
    />
  );
}
