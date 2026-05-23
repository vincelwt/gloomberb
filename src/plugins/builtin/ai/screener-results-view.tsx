import { useMemo } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { EmptyState, Spinner, TickerListTableView, type DataTableKeyEvent } from "../../../components";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { colors } from "../../../theme/colors";
import { getColumnValue, type ColumnContext } from "../portfolio-list/metrics";
import type { ValidatedScreenerResult } from "./screener-contract";
import type { AiScreenerTab, ScreenerSortPreference } from "./screener-model";
import { truncateWithEllipsis, wrapTextLines } from "../../../utils/text-wrap";

const DETAIL_FOOTER_LINES = 3;

export function AiScreenerResultsView({
  activeSort,
  activeTab,
  columnContext,
  columns,
  contentHeight,
  cursorSymbol,
  financialsMap,
  focused,
  isRunningActiveTab,
  promptDirty,
  resultMap,
  sortedTickers,
  width,
  onHeaderClick,
  onRootKeyDown,
  onRowActivate,
  setCursorSymbol,
}: {
  activeSort: ScreenerSortPreference;
  activeTab: AiScreenerTab | null;
  columnContext: ColumnContext;
  columns: ColumnConfig[];
  contentHeight: number;
  cursorSymbol: string | null;
  financialsMap: Map<string, TickerFinancials>;
  focused: boolean;
  isRunningActiveTab: boolean;
  promptDirty: boolean;
  resultMap: Map<string, ValidatedScreenerResult>;
  sortedTickers: TickerRecord[];
  width: number;
  onHeaderClick: (columnId: string) => void;
  onRootKeyDown: (event: DataTableKeyEvent) => boolean | void;
  onRowActivate: (ticker: TickerRecord) => void;
  setCursorSymbol: (symbol: string) => void;
}) {
  const detailTextWidth = Math.max(12, width - 2);
  const warningColor = colors.borderFocused;
  const selectedResult = activeTab?.results.find((result) => result.symbol === cursorSymbol)
    ?? activeTab?.results[0]
    ?? null;
  const summaryLines = useMemo(() => (
    activeTab?.summary
      ? wrapTextLines(activeTab.summary, detailTextWidth, 2)
      : []
  ), [activeTab?.summary, detailTextWidth]);
  const detailLines = promptDirty
    ? wrapTextLines("Prompt changed. Refresh to rerun this screener.", detailTextWidth, DETAIL_FOOTER_LINES)
    : selectedResult
      ? [
        `${selectedResult.symbol}${selectedResult.resolvedName ? ` · ${selectedResult.resolvedName}` : ""}`,
        ...wrapTextLines(selectedResult.reason, detailTextWidth, DETAIL_FOOTER_LINES - 1),
      ]
      : activeTab
        ? ["No validated results yet."]
        : ["Create an AI screener tab to begin."];
  const paddedDetailLines = [...detailLines];
  while (paddedDetailLines.length < DETAIL_FOOTER_LINES) {
    paddedDetailLines.push("");
  }

  return (
    <>
      {activeTab?.lastError && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          {wrapTextLines(activeTab.lastError, detailTextWidth, 2).map((line, index) => (
            <Box key={`error:${index}`} height={1}>
              <Text fg={colors.negative}>{line || " "}</Text>
            </Box>
          ))}
        </Box>
      )}

      {activeTab?.lastWarning && !activeTab.lastError && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          {wrapTextLines(activeTab.lastWarning, detailTextWidth, 2).map((line, index) => (
            <Box key={`warning:${index}`} height={1}>
              <Text fg={warningColor}>{line || " "}</Text>
            </Box>
          ))}
        </Box>
      )}

      {activeTab && summaryLines.length > 0 && !activeTab.lastError && (
        <Box flexDirection="column" paddingX={1} paddingTop={activeTab.lastWarning ? 0 : 1}>
          {summaryLines.map((line, index) => (
            <Box key={`summary:${index}`} height={1}>
              <Text fg={colors.textDim}>{line || " "}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexGrow={1} minHeight={contentHeight}>
        {!activeTab ? (
          <Box padding={1} flexGrow={1}>
            <EmptyState title="No AI screeners yet." hint="Click + to create one." />
          </Box>
        ) : isRunningActiveTab && activeTab.results.length === 0 ? (
          <Box padding={1} flexGrow={1}>
            <Spinner label="Running AI screener..." />
          </Box>
        ) : (
          <TickerListTableView
            focused={focused}
            columns={columns}
            tickers={sortedTickers}
            cursorSymbol={cursorSymbol}
            setCursorSymbol={setCursorSymbol}
            resolveCell={(column, ticker, financials) => {
              if (column.id === "ticker") {
                return {
                  text: ticker.metadata.ticker,
                };
              }
              if (column.id === "reason") {
                return {
                  text: truncateWithEllipsis(resultMap.get(ticker.metadata.ticker)?.reason ?? "", column.width),
                };
              }
              return getColumnValue(column, ticker, financials, columnContext);
            }}
            financialsMap={financialsMap}
            sortColumnId={activeSort.columnId}
            sortDirection={activeSort.direction}
            onHeaderClick={onHeaderClick}
            onRootKeyDown={onRootKeyDown}
            resetScrollKey={activeTab.id}
            onRowActivate={onRowActivate}
            emptyTitle="No matches yet."
            emptyHint={promptDirty ? "Prompt changed. Refresh to rerun." : "Run this screener. Use PS to customize columns."}
          />
        )}
      </Box>

      <Box height={1} paddingX={1}>
        <Text fg={colors.textDim}>{"\u2500".repeat(Math.max(width - 2, 0))}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} minHeight={DETAIL_FOOTER_LINES}>
        {paddedDetailLines.map((line, index) => (
          <Box key={`detail:${index}`} height={1}>
            <Text
              fg={promptDirty ? warningColor : index === 0 && selectedResult ? colors.text : colors.textDim}
              attributes={index === 0 && selectedResult ? TextAttributes.BOLD : 0}
            >
              {line || " "}
            </Text>
          </Box>
        ))}
      </Box>
    </>
  );
}
