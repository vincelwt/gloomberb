import { Box, ScrollBox, Text } from "../../../ui";
import { useMemo } from "react";
import { TextAttributes } from "../../../ui";
import { usePaneFooter } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { getSharedRegistry } from "../../registry";
import { useAppSelector, usePaneInstance } from "../../../state/app-context";
import { useChartQueries } from "../../../market-data/hooks";
import { buildChartKey } from "../../../market-data/selectors";
import type { PricePoint } from "../../../types/financials";
import type { QueryEntry } from "../../../market-data/result-types";
import { formatTickerListInput } from "../../../utils/ticker-list";
import {
  computeDatedReturns,
  correlateDatedReturns,
  formatCorrelation,
  correlationColor,
  type CorrelationResult,
  type DatedReturn,
} from "./compute";
import {
  DEFAULT_CORRELATION_SYMBOLS,
  MAX_CORRELATION_TICKERS,
  buildCorrelationSettingsDef,
  getCorrelationPaneSettings,
  type CorrelationRangePreset,
} from "./settings";

const ROW_HEADER_WIDTH = 7;
const MATRIX_CELL_WIDTH = 10;
const MIN_MATRIX_CELL_WIDTH = 7;
const MIN_CORRELATION_OBSERVATIONS = 5;

type SeriesStatus = "loading" | "ready" | "insufficient" | "empty" | "error";

interface CorrelationInstrument {
  symbol: string;
  exchange: string;
}

interface CorrelationSeries {
  symbol: string;
  returns: DatedReturn[];
  status: SeriesStatus;
  observationCount: number;
}

function displaySymbol(symbol: string): string {
  return symbol.length > 5 ? symbol.slice(0, 5) : symbol;
}

function pairKey(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

function formatSymbolList(symbols: string[]): string {
  if (symbols.length <= 3) return symbols.join(", ");
  return `${symbols.slice(0, 3).join(", ")} +${symbols.length - 3}`;
}

function formatSeriesSymbolList(symbols: string[], seriesBySymbol: Map<string, CorrelationSeries>, includeCounts = false): string {
  return formatSymbolList(symbols.map((symbol) => {
    const series = seriesBySymbol.get(symbol);
    return includeCounts && series ? `${symbol}(${series.observationCount})` : symbol;
  }));
}

function getSeriesForEntry(
  symbol: string,
  entry: QueryEntry<PricePoint[]> | undefined,
): CorrelationSeries {
  const priceHistory = entry?.data ?? entry?.lastGoodData ?? null;

  if (!priceHistory || priceHistory.length === 0) {
    if (entry?.error?.reasonCode === "NO_DATA") {
      return { symbol, returns: [], status: "empty", observationCount: 0 };
    }
    if (entry?.phase === "error" || entry?.error) {
      return {
        symbol,
        returns: [],
        status: "error",
        observationCount: 0,
      };
    }
    return { symbol, returns: [], status: "loading", observationCount: 0 };
  }

  const returns = computeDatedReturns(priceHistory);
  if (returns.length < MIN_CORRELATION_OBSERVATIONS) {
    return {
      symbol,
      returns,
      status: "insufficient",
      observationCount: returns.length,
    };
  }

  return { symbol, returns, status: "ready", observationCount: returns.length };
}

function rowHeaderColor(status: SeriesStatus): string {
  switch (status) {
    case "loading":
      return colors.textDim;
    case "error":
    case "empty":
      return colors.negative;
    case "insufficient":
      return colors.textMuted;
    case "ready":
      return colors.textBright;
  }
}

function buildStatusSummary(
  symbols: string[],
  seriesBySymbol: Map<string, CorrelationSeries>,
  sampleMin: number | null,
  sampleMax: number | null,
): string {
  const parts: string[] = [];
  const byStatus = (status: SeriesStatus) => symbols.filter((symbol) => seriesBySymbol.get(symbol)?.status === status);

  const loading = byStatus("loading");
  const errors = [...byStatus("error"), ...byStatus("empty")];
  const insufficient = byStatus("insufficient");

  if (loading.length > 0) parts.push(`Loading: ${formatSeriesSymbolList(loading, seriesBySymbol)}`);
  if (errors.length > 0) parts.push(`No data: ${formatSeriesSymbolList(errors, seriesBySymbol)}`);
  if (insufficient.length > 0) parts.push(`Need history: ${formatSeriesSymbolList(insufficient, seriesBySymbol, true)}`);

  if (sampleMin != null && sampleMax != null) {
    parts.push(sampleMin === sampleMax ? `obs ${sampleMin}` : `obs ${sampleMin}-${sampleMax}`);
  } else if (symbols.length >= 2) {
    parts.push("No paired dates yet");
  }

  parts.push(`— <${MIN_CORRELATION_OBSERVATIONS} shared`);
  return parts.join(" · ");
}

function buildCorrelationPaneTitle(symbols: string[], rangePreset: CorrelationRangePreset): string {
  if (symbols.length === 0) return `Correlation ${rangePreset}`;
  if (symbols.length <= 3) return `${symbols.join(" · ")} ${rangePreset}`;
  return `${symbols.slice(0, 2).join(" · ")} +${symbols.length - 2} ${rangePreset}`;
}

export function CorrelationMatrixPane({ width, height }: PaneProps) {
  const pane = usePaneInstance();
  const tickers = useAppSelector((state) => state.tickers);
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
    const results = new Map<string, CorrelationResult>();
    const sampleSizes: number[] = [];

    for (let rowIndex = 0; rowIndex < symbols.length; rowIndex++) {
      for (let colIndex = 0; colIndex < symbols.length; colIndex++) {
        if (rowIndex === colIndex) continue;
        const rowSym = symbols[rowIndex]!;
        const colSym = symbols[colIndex]!;
        const rowSeries = seriesBySymbol.get(rowSym);
        const colSeries = seriesBySymbol.get(colSym);
        const result = rowSeries && colSeries
          ? correlateDatedReturns(rowSeries.returns, colSeries.returns, MIN_CORRELATION_OBSERVATIONS)
          : { correlation: null, sampleSize: 0 };
        results.set(pairKey(rowSym, colSym), result);
        if (rowIndex < colIndex && result.sampleSize > 0) {
          sampleSizes.push(result.sampleSize);
        }
      }
    }

    return {
      results,
      sampleMin: sampleSizes.length > 0 ? Math.min(...sampleSizes) : null,
      sampleMax: sampleSizes.length > 0 ? Math.max(...sampleSizes) : null,
    };
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
          <Box key={sym} width={cellWidth} justifyContent="flex-end" paddingRight={1} overflow="hidden">
            <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>
              {displaySymbol(sym)}
            </Text>
          </Box>
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
                onMouseDown={() => getSharedRegistry()?.navigateTickerFn(rowSym)}
              >
                <Text
                  fg={rowHeaderColor(seriesBySymbol.get(rowSym)?.status ?? "loading")}
                  attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
                >
                  {displaySymbol(rowSym)}
                </Text>
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
                const cellColor = isDiag
                  ? colors.textDim
                  : correlationColor(r, colors.positive, colors.negative, colors.textMuted);
                const text = isDiag ? " 1.00" : formatCorrelation(r);
                return (
                  <Box
                    key={colSym}
                    width={cellWidth}
                    justifyContent="flex-end"
                    paddingRight={1}
                    backgroundColor={isDiag ? headerBg : undefined}
                  >
                    <Text fg={cellColor}>{text}</Text>
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
  ],
};
