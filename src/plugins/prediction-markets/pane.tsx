import { TextAttributes } from "@opentui/core";
import { PageStackView, TabBar } from "../../components";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { PREDICTION_CATEGORY_OPTIONS } from "./categories";
import { usePredictionMarketsController } from "./controller";
import { PredictionMarketDetailPane } from "./detail/pane";
import { BROWSE_TABS, VENUE_TABS } from "./navigation";
import { PredictionMarketsTable } from "./table";
import type { PredictionBrowseTab, PredictionCategoryId } from "./types";

export function PredictionMarketsPane({ focused, width, height }: PaneProps) {
  const controller = usePredictionMarketsController({ focused });
  const catalogStatusColor =
    controller.catalogStatus?.tone === "danger"
      ? colors.negative
      : colors.borderFocused;

  const browseContent = (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.panel}
    >
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

      <box flexDirection="column" flexGrow={1}>
        <PredictionMarketsTable
          columns={controller.visibleColumns}
          rows={controller.visibleRows}
          selectedRowKey={controller.selectedRow?.key ?? null}
          hoveredIdx={controller.hoveredIdx}
          setHoveredIdx={controller.actions.setHoveredIdx}
          onSelectRow={(rowKey) => controller.actions.setBrowseSelection(rowKey)}
          onOpenRow={controller.actions.openSelectedRow}
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
    </box>
  );

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
    <PageStackView
      focused={focused}
      detailOpen={controller.detailOpen && !!controller.selectedSummary}
      onBack={controller.actions.closeDetail}
      rootContent={browseContent}
      detailContent={detailContent}
    />
  );
}
