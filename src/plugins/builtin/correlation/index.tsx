import { Box, ScrollBox, Text } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import { usePaneFooter } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { usePluginTickerActions } from "../../plugin-runtime";
import { useAppSelector, usePaneInstance } from "../../../state/app-context";
import { useChartQueries } from "../../../market-data/hooks";
import { buildChartKey } from "../../../market-data/selectors";
import { formatTickerListInput } from "../../../utils/ticker-list";
import { formatCorrelation } from "./compute";
import {
  DEFAULT_CORRELATION_SYMBOLS,
  MAX_CORRELATION_TICKERS,
  buildCorrelationSettingsDef,
  getCorrelationPaneSettings,
} from "./settings";
import { resolveCorrelationHeatmapCellColors } from "./colors";
import {
  createRelationshipPaneTemplate,
  RelationshipGraphPane,
} from "./relationship-pane";
import {
  MATRIX_CELL_WIDTH,
  MIN_MATRIX_CELL_WIDTH,
  ROW_HEADER_WIDTH,
  buildCorrelationMatrix,
  buildCorrelationPaneTitle,
  buildStatusSummary,
  displaySymbol,
  getSeriesForEntry,
  pairKey,
  rowHeaderColor,
} from "./matrix-model";
import { SymbolLabelCell } from "./matrix-symbol-cell";

function CorrelationMatrixPane({ width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { navigateTicker, pinTicker } = usePluginTickerActions();
  const tickers = useAppSelector((state) => state.tickers);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const settings = useMemo(() => getCorrelationPaneSettings(pane?.settings), [pane?.settings]);

  const instruments = useMemo(() => {
    if (settings.symbolsError) return [];
    return settings.symbols.map((symbol) => {
      const ticker = tickers.get(symbol);
      return {
        symbol,
        exchange: ticker?.metadata.exchange ?? "",
      };
    });
  }, [settings.symbols.join(","), settings.symbolsError, tickers]);

  const instrumentKey = instruments.map((instrument) => `${instrument.symbol}|${instrument.exchange}`).join(",");

  const chartRequests = useMemo(
    () => instruments.map((instrument) => ({
      instrument: {
        symbol: instrument.symbol,
        exchange: instrument.exchange,
      },
      bufferRange: settings.rangePreset,
      granularity: "resolution" as const,
      resolution: "1d" as const,
    })),
    [instrumentKey, settings.rangePreset],
  );

  const chartEntries = useChartQueries(chartRequests);

  const seriesBySymbol = useMemo(() => {
    const map = new Map<string, CorrelationSeries>();
    for (let i = 0; i < instruments.length; i++) {
      const instrument = instruments[i]!;
      const request = chartRequests[i]!;
      const key = buildChartKey(request);
      const entry = chartEntries.get(key);
      map.set(instrument.symbol, getSeriesForEntry(instrument.symbol, entry));
    }
    return map;
  }, [chartEntries, chartRequests, instruments]);

  const symbols = instruments.map((instrument) => instrument.symbol);
  const symbolsKey = symbols.join(",");

  const matrix = useMemo(() => {
    return buildCorrelationMatrix(symbols, seriesBySymbol);
  }, [symbolsKey, seriesBySymbol]);

  const statusSummary = useMemo(
    () => buildStatusSummary(symbols, seriesBySymbol, matrix.sampleMin, matrix.sampleMax),
    [symbolsKey, seriesBySymbol, matrix.sampleMin, matrix.sampleMax],
  );

  usePaneFooter("correlation", () => ({
    info: [
      { id: "tickers", parts: [{ text: `${symbols.length} tickers`, tone: symbols.length >= 2 ? "value" : "warning", bold: symbols.length >= 2 }] },
      { id: "range", parts: [{ text: settings.rangePreset, tone: "muted" }] },
      ...(settings.symbolsError
        ? [{ id: "error", parts: [{ text: settings.symbolsError, tone: "warning" as const }] }]
        : [{ id: "status", parts: [{ text: statusSummary, tone: "muted" as const }] }]),
    ],
  }), [settings.rangePreset, settings.symbolsError, statusSummary, symbols.length]);

  const openSymbol = useCallback((symbol: string) => {
    if (tickers.has(symbol)) {
      pinTicker(symbol, { floating: true, paneType: "ticker-detail" });
      return;
    }
    navigateTicker(symbol);
  }, [navigateTicker, pinTicker, tickers]);

  const clearHoveredSymbol = useCallback((symbol: string) => {
    setHoveredSymbol((current) => (current === symbol ? null : current));
  }, []);

  if (settings.symbolsError) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingX={2} paddingY={1}>
        <Text fg={colors.negative}>Invalid CORR tickers: {settings.symbolsError}</Text>
        <Text fg={colors.textMuted}>Open pane settings and enter tickers like AAPL, MSFT, NVDA.</Text>
      </Box>
    );
  }

  if (symbols.length < 2) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingX={2} paddingY={1}>
        <Text fg={colors.textMuted}>Enter at least 2 tickers in pane settings</Text>
      </Box>
    );
  }

  const headerBg = colors.panel;
  const rowHeaderWidth = Math.max(
    ROW_HEADER_WIDTH,
    Math.min(12, Math.max(...symbols.map((symbol) => displaySymbol(symbol).length)) + 2),
  );
  const availableCellWidth = Math.floor((Math.max(width - rowHeaderWidth - 4, symbols.length * MIN_MATRIX_CELL_WIDTH)) / symbols.length);
  const cellWidth = Math.max(MIN_MATRIX_CELL_WIDTH, Math.min(MATRIX_CELL_WIDTH, availableCellWidth));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Column header row */}
      <Box flexDirection="row" paddingX={1} height={1} backgroundColor={headerBg}>
        <Box width={rowHeaderWidth} flexShrink={0} />
        {symbols.map((sym) => (
          <SymbolLabelCell
            key={sym}
            symbol={sym}
            width={cellWidth}
            align="flex-end"
            color={colors.textDim}
            hovered={hoveredSymbol === sym}
            onHover={setHoveredSymbol}
            onLeave={clearHoveredSymbol}
            onOpen={openSymbol}
          />
        ))}
      </Box>

      {/* Matrix rows */}
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {symbols.map((rowSym, rowIndex) => (
            <Box key={rowSym} flexDirection="row" paddingX={1} backgroundColor={rowIndex % 2 === 0 ? colors.bg : undefined}>
              {/* Row header */}
              <Box
                width={rowHeaderWidth}
                flexShrink={0}
                overflow="hidden"
              >
                <SymbolLabelCell
                  symbol={rowSym}
                  width={rowHeaderWidth}
                  color={rowHeaderColor(seriesBySymbol.get(rowSym)?.status ?? "loading")}
                  hovered={hoveredSymbol === rowSym}
                  onHover={setHoveredSymbol}
                  onLeave={clearHoveredSymbol}
                  onOpen={openSymbol}
                />
              </Box>
              {/* Cells */}
              {symbols.map((colSym) => {
                const isDiag = rowSym === colSym;
                let r: number | null = null;
                if (isDiag) {
                  r = 1;
                } else {
                  r = matrix.results.get(pairKey(rowSym, colSym))?.correlation ?? null;
                }
                const cellColors = resolveCorrelationHeatmapCellColors(r);
                const text = isDiag ? " 1.00" : formatCorrelation(r);
                return (
                  <Box
                    key={colSym}
                    width={cellWidth}
                    justifyContent="flex-end"
                    paddingRight={1}
                    backgroundColor={cellColors.background}
                  >
                    <Text fg={cellColors.foreground}>{text}</Text>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </ScrollBox>

    </Box>
  );
}

export const correlationPlugin: GloomPlugin = {
  id: "correlation",
  name: "Correlation Matrix",
  version: "1.0.0",
  description: "NxN Pearson correlation matrix for tickers in portfolios/watchlists",
  toggleable: true,

  panes: [
    {
      id: "correlation",
      name: "Correlation Matrix",
      icon: "C",
      component: CorrelationMatrixPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 18 },
      settings: buildCorrelationSettingsDef(),
    },
    {
      id: "relationship-graph",
      name: "Relationship Graph",
      icon: "R",
      component: RelationshipGraphPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "correlation-pane",
      paneId: "correlation",
      label: "Correlation Matrix",
      description: "Date-aligned Pearson correlation matrix for ticker returns.",
      keywords: ["correlation", "corr", "matrix", "pearson", "returns", "covariance"],
      shortcut: { prefix: "CORR", argPlaceholder: "tickers", argKind: "ticker-list" },
      wizard: [
        {
          key: "tickers",
          label: "Correlation Tickers",
          placeholder: formatTickerListInput(DEFAULT_CORRELATION_SYMBOLS),
          defaultValue: formatTickerListInput(DEFAULT_CORRELATION_SYMBOLS),
          body: [
            `Enter 2-${MAX_CORRELATION_TICKERS} ticker symbols separated by commas.`,
          ],
          type: "text",
        },
      ],
      createInstance: (_context, options) => {
        const symbols = options?.symbols && options.symbols.length >= 2
          ? options.symbols
          : DEFAULT_CORRELATION_SYMBOLS;
        return {
          title: buildCorrelationPaneTitle(symbols, "1Y"),
          placement: "floating",
          settings: {
            rangePreset: "1Y",
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        };
      },
    },
    createRelationshipPaneTemplate(),
  ],
};
