import { useCallback, useMemo } from "react";
import { Box, Text, useUiCapabilities } from "../../../ui";
import { TextAttributes } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import type { QuoteSubscriptionTarget } from "../../../types/data-provider";
import { quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { useTickerFinancials } from "../../../market-data/hooks";
import { useAppSelector, usePaneInstance, usePaneTicker } from "../../../state/app-context";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { usePluginAppActions, usePluginTickerActions } from "../../plugin-runtime";
import { useDoubleClickActivation } from "../../../components/use-double-click-activation";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { formatMarketPriceWithCurrency, formatSignedMarketPrice } from "../../../utils/market-format";
import { getActiveQuoteDisplay } from "../../../utils/market-status";
import { EmptyState } from "../../../components";
import {
  PriceAreaSparklineBackground,
  PriceSparkline,
  resolvePriceSparklineRange,
  type PriceSparklinePeriod,
  type PriceSparklineTrend,
} from "../../../components/price-sparkline-view";
import { getQuoteMonitorPaneSettings } from "./settings";
import { useShortcut } from "../../../react/input";

function getQuoteMonitorDisplay(quote: Quote | null | undefined) {
  return getActiveQuoteDisplay(quote);
}

function chunkSymbols(symbols: string[], columns: number): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < symbols.length; index += columns) {
    rows.push(symbols.slice(index, index + columns));
  }
  return rows;
}

function resolveGridColumnCount(symbolCount: number, width: number, height: number, nativePaneChrome: boolean): number {
  if (symbolCount <= 1) return 1;

  const contentWidth = Math.max(1, width - (nativePaneChrome ? 0 : 2));
  const contentHeight = Math.max(1, height);
  const minimumCellWidth = nativePaneChrome ? 34 : 28;
  const minimumCellHeight = nativePaneChrome ? 4 : 3;
  const maxColumns = Math.max(1, Math.min(symbolCount, Math.floor(contentWidth / minimumCellWidth)));
  const targetAspect = nativePaneChrome ? 5.5 : 4.5;
  let bestColumns = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let columns = 1; columns <= maxColumns; columns++) {
    const rows = Math.ceil(symbolCount / columns);
    const cellWidth = Math.floor(contentWidth / columns);
    const cellHeight = Math.floor(contentHeight / rows);
    const aspect = cellWidth / Math.max(1, cellHeight);
    const emptySlots = columns * rows - symbolCount;
    const widthPenalty = cellWidth < minimumCellWidth ? (minimumCellWidth - cellWidth) * 0.5 : 0;
    const heightPenalty = cellHeight < minimumCellHeight ? (minimumCellHeight - cellHeight) * 1.4 : 0;
    const score = Math.abs(Math.log(aspect / targetAspect))
      + emptySlots * 0.35
      + widthPenalty
      + heightPenalty
      - columns * 0.03;
    if (score < bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }

  return bestColumns;
}

function quoteTrend(value: number | null | undefined): PriceSparklineTrend {
  if (value == null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function QuoteMonitorCard({
  symbol,
  ticker,
  cachedFinancials,
  width,
  height,
  showRightDivider,
  showBottomDivider,
  chartPeriod,
  onOpen,
}: {
  symbol: string;
  ticker: TickerRecord | null;
  cachedFinancials: TickerFinancials | null;
  width: number;
  height: number;
  showRightDivider: boolean;
  showBottomDivider: boolean;
  chartPeriod: PriceSparklinePeriod;
  onOpen: (symbol: string) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const marketFinancials = useTickerFinancials(symbol, ticker);
  const financials = marketFinancials ?? cachedFinancials;
  const quote = financials?.quote;
  const display = getQuoteMonitorDisplay(quote);
  const changeColor = priceColor(display?.change ?? 0);
  const currency = quote?.currency ?? ticker?.metadata.currency ?? "USD";
  const stacked = width < 31;
  const priceText = display
    ? formatMarketPriceWithCurrency(display.price, currency, { assetCategory: ticker?.metadata.assetCategory })
    : "";
  const changePercentText = display ? formatPercentRaw(display.changePercent) : "";
  const changeValueText = display ? formatSignedMarketPrice(display.change, { assetCategory: ticker?.metadata.assetCategory }) : "";
  const priceColumnWidth = Math.max(priceText.length, changePercentText.length + changeValueText.length + 1);
  const nameMaxWidth = Math.max(10, width - priceColumnWidth - (nativePaneChrome ? 5 : 3));
  const sparklineRange = resolvePriceSparklineRange(financials?.priceHistory, chartPeriod);
  const rangeLabel = sparklineRange
    ? `${chartPeriod} ${formatMarketPriceWithCurrency(sparklineRange.min, currency, { assetCategory: ticker?.metadata.assetCategory })}-${formatMarketPriceWithCurrency(sparklineRange.max, currency, { assetCategory: ticker?.metadata.assetCategory })}`
    : "";
  const sparklineWidth = Math.max(8, width - (nativePaneChrome ? rangeLabel.length + 5 : 2));
  const trend = quoteTrend(display?.change);
  const terminalSparklineHeight = !nativePaneChrome && !stacked && height >= 4 ? 2 : 1;
  const desktopPriceStyle = nativePaneChrome
    ? {
        fontSize: "22px",
        lineHeight: "1.05",
        fontWeight: 720,
        textShadow: `0 1px 2px ${colors.bg}`,
      }
    : undefined;
  const desktopChangeStyle = nativePaneChrome
    ? {
        fontSize: "12px",
        lineHeight: "1.1",
        fontWeight: 540,
        textShadow: `0 1px 2px ${colors.bg}`,
      }
    : undefined;
  const desktopSymbolStyle = nativePaneChrome
    ? {
        fontSize: "15px",
        lineHeight: "18px",
      }
    : undefined;

  const handleMouseDown = useDoubleClickActivation<string>({
    onActivate: onOpen,
  });

  return (
    <Box
      flexDirection="column"
      width={nativePaneChrome ? undefined : width}
      height={nativePaneChrome ? undefined : height}
      backgroundColor={colors.bg}
      paddingX={nativePaneChrome ? 0 : 1}
      paddingY={0}
      overflow="hidden"
      onMouseDown={(event: any) => {
        event.preventDefault?.();
        handleMouseDown(symbol, symbol, event);
      }}
      data-gloom-role="quote-monitor-card"
      style={nativePaneChrome ? {
        cursor: "pointer",
        position: "relative",
        width: "100%",
        height: "100%",
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 6,
        paddingBottom: 4,
        borderRight: showRightDivider ? `1px solid ${colors.border}` : undefined,
        borderBottom: showBottomDivider ? `1px solid ${colors.border}` : undefined,
      } : undefined}
    >
      {nativePaneChrome && display && (
        <PriceAreaSparklineBackground priceHistory={financials?.priceHistory} trend={trend} period={chartPeriod} />
      )}
      {!display ? (
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text attributes={TextAttributes.BOLD} fg={colors.textBright} style={desktopSymbolStyle}>
            {symbol}
          </Text>
          <Text fg={colors.textDim}>Waiting for quote...</Text>
        </Box>
      ) : nativePaneChrome ? (
        <Box
          flexGrow={1}
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gridTemplateColumns: "minmax(130px, 1fr) minmax(88px, auto)",
            gridTemplateRows: "auto 1fr auto",
            columnGap: 12,
            width: "100%",
            height: "100%",
          }}
        >
          <Box
            flexDirection="column"
            minWidth={0}
            style={{
              gridColumn: "1",
              gridRow: "1 / span 2",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <Text attributes={TextAttributes.BOLD} fg={colors.textBright} style={desktopSymbolStyle}>
              {symbol}
            </Text>
            {ticker?.metadata.name && (
              <Text
                fg={colors.textDim}
                style={{
                  fontSize: "12px",
                  lineHeight: "14px",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {ticker.metadata.name}
              </Text>
            )}
          </Box>

          <Box
            flexDirection="column"
            alignItems="flex-end"
            style={{
              gridColumn: "2",
              gridRow: "1",
              justifySelf: "end",
              backgroundColor: colors.bg,
              borderRadius: 4,
              boxShadow: `0 0 0 2px ${colors.bg}`,
              paddingLeft: 6,
              paddingBottom: 1,
            }}
          >
            <Text
              attributes={TextAttributes.BOLD}
              fg={changeColor}
              style={desktopPriceStyle}
            >
              {priceText}
            </Text>
            <Box flexDirection="row" gap={1} justifyContent="flex-end">
              <Text fg={changeColor} style={desktopChangeStyle}>{changePercentText}</Text>
              <Text fg={changeColor} style={desktopChangeStyle}>{changeValueText}</Text>
            </Box>
          </Box>

          {rangeLabel && (
            <Text
              fg={colors.textDim}
              style={{
                gridColumn: "2",
                gridRow: "3",
                justifySelf: "end",
                alignSelf: "end",
                fontSize: "11px",
                lineHeight: "13px",
                backgroundColor: colors.bg,
                paddingLeft: 6,
                paddingRight: 2,
                boxShadow: `0 0 0 2px ${colors.bg}`,
              }}
            >
              {rangeLabel}
            </Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} justifyContent="flex-start">
          {stacked ? (
            <Box flexDirection="column">
              <Text attributes={TextAttributes.BOLD} fg={colors.textBright} style={desktopSymbolStyle}>
                {symbol}
              </Text>
              <Box flexDirection="column">
                <Text attributes={TextAttributes.BOLD} fg={changeColor} style={desktopPriceStyle}>
                  {priceText}
                </Text>
                <Box flexDirection="row" gap={1}>
                  <Text fg={changeColor} style={desktopChangeStyle}>{changePercentText}</Text>
                  <Text fg={changeColor} style={desktopChangeStyle}>{changeValueText}</Text>
                </Box>
              </Box>
            </Box>
          ) : (
            <Box
              flexDirection="row"
              alignItems="flex-start"
              justifyContent="space-between"
              gap={1}
            >
              <Box flexDirection="column" flexGrow={1} minWidth={0}>
                <Text attributes={TextAttributes.BOLD} fg={colors.textBright} style={desktopSymbolStyle}>
                  {symbol}
                </Text>
                {nativePaneChrome && ticker?.metadata.name && width >= 36 && (
                  <Text
                    fg={colors.textDim}
                    style={{
                      fontSize: "12px",
                      lineHeight: "16px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    maxWidth={nameMaxWidth}
                  >
                    {ticker.metadata.name}
                  </Text>
                )}
              </Box>
              <Box flexDirection="column" alignItems="flex-end">
                <Text
                  attributes={TextAttributes.BOLD}
                  fg={changeColor}
                  style={desktopPriceStyle}
                >
                  {priceText}
                </Text>
                <Box flexDirection="row" gap={1} justifyContent="flex-end">
                  <Text fg={changeColor} style={desktopChangeStyle}>{changePercentText}</Text>
                  <Text fg={changeColor} style={desktopChangeStyle}>{changeValueText}</Text>
                </Box>
              </Box>
            </Box>
          )}

          <Box height={terminalSparklineHeight} flexDirection="row" alignItems="center" gap={1}>
            <PriceSparkline
              priceHistory={financials?.priceHistory}
              width={sparklineWidth}
              height={terminalSparklineHeight}
              trend={trend}
              period={chartPeriod}
              area={!nativePaneChrome}
            />
            {nativePaneChrome && rangeLabel && (
              <Text fg={colors.textDim} style={{ fontSize: "11px", lineHeight: "14px" }}>
                {rangeLabel}
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function QuoteMonitorPane({ paneId, focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol: fallbackSymbol, ticker: fallbackTicker } = usePaneTicker();
  const settings = useMemo(
    () => getQuoteMonitorPaneSettings(pane?.settings, fallbackSymbol),
    [fallbackSymbol, pane?.settings],
  );
  const symbols = settings.symbols;
  const financialsBySymbol = useAppSelector((state) => state.financials);
  const tickersBySymbol = useAppSelector((state) => state.tickers);
  const streamingTargets = useMemo(() => (
    symbols
      .map((symbol) => {
        const ticker = tickersBySymbol.get(symbol) ?? (fallbackTicker?.metadata.ticker === symbol ? fallbackTicker : null);
        return quoteSubscriptionTargetFromTicker(ticker, symbol, "provider");
      })
      .filter((target): target is QuoteSubscriptionTarget => target != null)
  ), [fallbackTicker, symbols, tickersBySymbol]);
  useQuoteStreaming(streamingTargets);
  const { pinTicker } = usePluginTickerActions();
  const { openPaneSettings } = usePluginAppActions();
  const { nativePaneChrome } = useUiCapabilities();
  const openTicker = useCallback((nextSymbol: string) => {
    pinTicker(nextSymbol, { paneType: "ticker-detail", floating: true });
  }, [pinTicker]);
  useShortcut((event) => {
    if (!focused || event.name !== "t") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    openPaneSettings(paneId);
  });

  if (symbols.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title="No tickers selected." />
      </Box>
    );
  }

  const columns = resolveGridColumnCount(symbols.length, width, height, nativePaneChrome);
  const rows = chunkSymbols(symbols, columns);
  const contentWidth = Math.max(1, width - (nativePaneChrome ? 0 : 2));
  const contentHeight = Math.max(3, height);
  const cardHeight = Math.max(nativePaneChrome ? 4 : 3, Math.floor(contentHeight / rows.length));
  const cardWidth = Math.max(1, Math.floor(contentWidth / columns));

  if (nativePaneChrome) {
    return (
      <Box
        flexGrow={1}
        backgroundColor={colors.bg}
        overflow="hidden"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
          gridAutoRows: "minmax(66px, 1fr)",
          alignItems: "stretch",
          alignContent: "stretch",
          width: "100%",
          height: "100%",
        }}
      >
        {symbols.map((symbol, index) => {
          const ticker = tickersBySymbol.get(symbol) ?? (fallbackTicker?.metadata.ticker === symbol ? fallbackTicker : null);
          return (
            <QuoteMonitorCard
              key={symbol}
              symbol={symbol}
              ticker={ticker}
              cachedFinancials={financialsBySymbol.get(symbol) ?? null}
              width={width}
              height={height}
              showRightDivider={false}
              showBottomDivider
              chartPeriod={settings.chartPeriod}
              onOpen={openTicker}
            />
          );
        })}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={colors.bg}
      paddingX={nativePaneChrome ? 0 : 1}
      paddingY={0}
      overflow="hidden"
    >
      {rows.map((row, rowIndex) => (
        <Box key={`${rowIndex}:${row.join(",")}`} flexDirection="row" height={cardHeight}>
          {row.map((symbol, columnIndex) => {
            const ticker = tickersBySymbol.get(symbol) ?? (fallbackTicker?.metadata.ticker === symbol ? fallbackTicker : null);
            return (
              <QuoteMonitorCard
                key={symbol}
                symbol={symbol}
                ticker={ticker}
                cachedFinancials={financialsBySymbol.get(symbol) ?? null}
                width={cardWidth}
                height={cardHeight}
                showRightDivider={columnIndex < row.length - 1}
                showBottomDivider={rowIndex < rows.length - 1}
                chartPeriod={settings.chartPeriod}
                onOpen={openTicker}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
