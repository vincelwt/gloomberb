import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { AnalystResearchData, CorporateActionsData, TickerFinancials } from "../../../types/financials";
import type { DetailTabProps, GloomPlugin, PaneProps } from "../../../types/plugin";
import { usePaneInstance, usePaneTicker } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatCurrency, formatNumber, formatPercent, formatPercentRaw } from "../../../utils/format";
import { parseTickerListInput, formatTickerListInput } from "../../../utils/ticker-list";
import { normalizeTickerInput } from "../../../utils/ticker-search";
import { useMarketData, usePluginTickerActions } from "../../plugin-runtime";

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

function useSymbolBinding() {
  const { symbol, ticker } = usePaneTicker();
  return {
    symbol,
    exchange: ticker?.metadata.exchange ?? "",
    currency: ticker?.metadata.currency ?? "USD",
  };
}

function useTickerRequest<T>(
  loader: (symbol: string, exchange: string, forceRefresh: boolean) => Promise<T>,
  symbol: string | null,
  exchange: string,
) {
  const [state, setState] = useState<LoadState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);

  const load = useCallback((forceRefresh = false) => {
    if (!symbol) {
      setState({ data: null, loading: false, error: "No ticker selected" });
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));

    loader(symbol, exchange, forceRefresh)
      .then((data) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [exchange, loader, symbol]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { ...state, reload: () => load(true) };
}

function compactPeriod(period: string): string {
  return period
    .replace("current ", "")
    .replace("previous ", "prev ")
    .replace("next_", "next ")
    .replace(/_/g, " ");
}

function targetUpside(target: AnalystResearchData["priceTarget"]): number | undefined {
  if (!target?.average || !target.current) return undefined;
  return (target.average - target.current) / target.current;
}

function latestRecommendation(data: AnalystResearchData | null) {
  return data?.recommendations[0] ?? null;
}

function recommendationTotal(data: AnalystResearchData | null): number {
  const rec = latestRecommendation(data);
  if (!rec) return 0;
  return (rec.strongBuy ?? 0) + (rec.buy ?? 0) + (rec.hold ?? 0) + (rec.sell ?? 0) + (rec.strongSell ?? 0);
}

function formatRatingLabel(value: number | undefined): string {
  return value == null ? "-" : `${formatNumber(value, 1)}/10`;
}

function ratingActionColor(action: string | undefined): string {
  const normalized = action?.toLowerCase() ?? "";
  if (normalized.includes("upgrade")) return colors.positive;
  if (normalized.includes("downgrade")) return colors.negative;
  return colors.textDim;
}

function AnalystSummary({ data, width }: { data: AnalystResearchData | null; width: number }) {
  const target = data?.priceTarget;
  const upside = targetUpside(target);
  const rec = latestRecommendation(data);
  const total = recommendationTotal(data);
  const currency = target?.currency ?? data?.currency ?? "USD";
  const summaryWidth = Math.max(1, width - 2);

  if (!data) {
    return (
      <Box flexDirection="column" paddingX={1} height={2}>
        <Text fg={colors.textDim}>Analyst data</Text>
        <Text fg={colors.textDim}>Waiting for a data source.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} height={4}>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {target?.average != null ? formatCurrency(target.average, currency) : "-"}
        </Text>
        <Text fg={colors.textDim}> avg target </Text>
        <Text fg={upside == null ? colors.textDim : priceColor(upside)}>
          {upside != null ? formatPercent(upside) : "-"}
        </Text>
        <Text fg={colors.textDim}> upside</Text>
        <Box flexGrow={1} />
        <Text fg={colors.textDim}>rating </Text>
        <Text fg={colors.text}>{formatRatingLabel(data?.recommendationRating)}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>low </Text>
        <Text fg={colors.text}>{target?.low != null ? formatCurrency(target.low, currency) : "-"}</Text>
        <Text fg={colors.textDim}>  median </Text>
        <Text fg={colors.text}>{target?.median != null ? formatCurrency(target.median, currency) : "-"}</Text>
        <Text fg={colors.textDim}>  high </Text>
        <Text fg={colors.text}>{target?.high != null ? formatCurrency(target.high, currency) : "-"}</Text>
      </Box>
      <Box height={1} width={summaryWidth} flexDirection="row">
        <Text fg={colors.textDim}>{compactPeriod(rec?.period ?? "")}</Text>
        <Box flexGrow={1} />
        <Text fg={colors.positive}>SB {rec?.strongBuy ?? 0}</Text>
        <Text fg={colors.text}>  B {rec?.buy ?? 0}</Text>
        <Text fg={colors.textDim}>  H {rec?.hold ?? 0}</Text>
        <Text fg={colors.negative}>  S {(rec?.sell ?? 0) + (rec?.strongSell ?? 0)}</Text>
        <Text fg={colors.textDim}>  n={total}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>
          {data?.ratings[0]
            ? `${data.ratings[0].firm} ${data.ratings[0].action ?? ""} ${data.ratings[0].current ?? ""}`.trim()
            : "No recent rating actions"}
        </Text>
      </Box>
    </Box>
  );
}

type RatingColumnId = "date" | "firm" | "action" | "current" | "prior";
type RatingColumn = DataTableColumn & { id: RatingColumnId };

const RATING_COLUMNS: RatingColumn[] = [
  { id: "date", label: "DATE", width: 10, align: "left" },
  { id: "firm", label: "FIRM", width: 24, align: "left" },
  { id: "action", label: "ACTION", width: 11, align: "left" },
  { id: "current", label: "RATING", width: 14, align: "left" },
  { id: "prior", label: "PRIOR", width: 14, align: "left" },
];

function AnalystResearchView({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const dataProvider = useMarketData();
  const { symbol, exchange } = useSymbolBinding();
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider.getAnalystResearch) throw new Error("Analyst data source unavailable");
    return dataProvider.getAnalystResearch(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<AnalystResearchData>(loader, symbol, exchange);
  const rows = data?.ratings ?? [];

  const renderCell = useCallback((
    row: AnalystResearchData["ratings"][number],
    column: RatingColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "firm":
        return { text: row.firm, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "action":
        return { text: row.action ?? "-", color: selectedColor ?? ratingActionColor(row.action) };
      case "current":
        return { text: row.current ?? "-", color: selectedColor ?? colors.text };
      case "prior":
        return { text: row.prior ?? "-", color: selectedColor ?? colors.textDim };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  usePaneFooter("analyst-research", () => ({
    info: [
      { id: "source", parts: [{ text: data?.providerId ?? "analyst", tone: "label" }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: reload }],
  }), [data?.providerId, error, loading, reload]);

  return (
    <DataTableView<AnalystResearchData["ratings"][number], RatingColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={<AnalystSummary data={data} width={width} />}
      onRootKeyDown={handleKeyDown}
      columns={RATING_COLUMNS}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(row, index) => `${row.date}:${row.firm}:${index}`}
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading analyst data..." : error ?? "No analyst data"}
      showHorizontalScrollbar={false}
    />
  );
}

type ActionRow = {
  id: string;
  date: string;
  type: "Dividend" | "Split" | "Earnings";
  detail: string;
  value: string;
  tone: "positive" | "negative" | "muted" | "text";
};

type ActionColumnId = "date" | "type" | "detail" | "value";
type ActionColumn = DataTableColumn & { id: ActionColumnId };

function buildActionRows(data: CorporateActionsData | null, currency: string): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const dividend of data?.dividends ?? []) {
    rows.push({
      id: `div:${dividend.exDate}`,
      date: dividend.exDate,
      type: "Dividend",
      detail: "Ex-date",
      value: formatCurrency(dividend.amount, currency),
      tone: "positive",
    });
  }
  for (const split of data?.splits ?? []) {
    rows.push({
      id: `split:${split.date}:${split.description ?? ""}`,
      date: split.date,
      type: "Split",
      detail: split.description ?? "Split",
      value: split.fromFactor && split.toFactor ? `${split.fromFactor}:${split.toFactor}` : formatNumber(split.ratio, 4),
      tone: "muted",
    });
  }
  for (const earning of data?.earnings ?? []) {
    rows.push({
      id: `earn:${earning.date}`,
      date: earning.date,
      type: "Earnings",
      detail: earning.epsActual != null
        ? `EPS ${formatNumber(earning.epsActual, 2)}`
        : "EPS pending",
      value: earning.surprisePercent != null ? formatPercentRaw(earning.surprisePercent) : "-",
      tone: earning.surprisePercent == null ? "muted" : earning.surprisePercent >= 0 ? "positive" : "negative",
    });
  }
  return rows.sort((left, right) => right.date.localeCompare(left.date));
}

function buildActionColumns(width: number): ActionColumn[] {
  const dateWidth = 10;
  const typeWidth = 9;
  const valueWidth = 10;
  const detailWidth = Math.max(16, width - dateWidth - typeWidth - valueWidth - 6);
  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
    { id: "detail", label: "DETAIL", width: detailWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
  ];
}

function toneColor(tone: ActionRow["tone"]): string {
  if (tone === "positive") return colors.positive;
  if (tone === "negative") return colors.negative;
  if (tone === "muted") return colors.textDim;
  return colors.text;
}

function CorporateActionsView({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const dataProvider = useMarketData();
  const { symbol, exchange, currency } = useSymbolBinding();
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider.getCorporateActions) throw new Error("Corporate actions source unavailable");
    return dataProvider.getCorporateActions(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<CorporateActionsData>(loader, symbol, exchange);
  const rows = useMemo(() => buildActionRows(data, data?.currency ?? currency), [currency, data]);
  const columns = useMemo(() => buildActionColumns(width), [width]);

  const renderCell = useCallback((
    row: ActionRow,
    column: ActionColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "type":
        return { text: row.type, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "detail":
        return { text: row.detail, color: selectedColor ?? colors.text };
      case "value":
        return { text: row.value, color: selectedColor ?? toneColor(row.tone) };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  usePaneFooter("corporate-actions", () => ({
    info: [
      { id: "source", parts: [{ text: data?.providerId ?? "events", tone: "label" }] },
      { id: "count", parts: [{ text: `${rows.length} rows`, tone: rows.length > 0 ? "value" as const : "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: reload }],
  }), [data?.providerId, error, loading, reload, rows.length]);

  return (
    <DataTableView<ActionRow, ActionColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={handleKeyDown}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.id}
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading events..." : error ?? "No events"}
      showHorizontalScrollbar={false}
    />
  );
}

type RelativeColumnId = "symbol" | "price" | "change" | "marketCap" | "pe" | "forwardPe" | "evSales" | "fcfYield" | "revenueGrowth" | "margin";
type RelativeColumn = DataTableColumn & { id: RelativeColumnId };
type RelativeRow = {
  symbol: string;
  financials: TickerFinancials | null;
  error?: string;
};

function relativeSymbolsFromPane(symbol: string | null, paneSettings: Record<string, unknown> | undefined): string[] {
  const settingsSymbols = Array.isArray(paneSettings?.symbols)
    ? paneSettings.symbols.filter((value): value is string => typeof value === "string")
    : [];
  if (settingsSymbols.length > 0) return settingsSymbols;
  return symbol ? [symbol] : [];
}

function buildRelativeColumns(width: number): RelativeColumn[] {
  const symbolWidth = 8;
  const priceWidth = 10;
  const pctWidth = 8;
  const capWidth = 9;
  const metricWidth = 8;
  return [
    { id: "symbol", label: "TICKER", width: symbolWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "change", label: "CHG%", width: pctWidth, align: "right" },
    { id: "marketCap", label: "MCAP", width: capWidth, align: "right" },
    { id: "pe", label: "P/E", width: metricWidth, align: "right" },
    { id: "forwardPe", label: "FWD", width: metricWidth, align: "right" },
    { id: "evSales", label: "EV/S", width: metricWidth, align: "right" },
    { id: "fcfYield", label: "FCF%", width: metricWidth, align: "right" },
    { id: "revenueGrowth", label: "REV%", width: metricWidth, align: "right" },
    { id: "margin", label: "OP%", width: Math.max(metricWidth, width - symbolWidth - priceWidth - pctWidth - capWidth - metricWidth * 5 - 10), align: "right" },
  ];
}

function evSales(financials: TickerFinancials | null): number | undefined {
  const ev = financials?.fundamentals?.enterpriseValue;
  const revenue = financials?.fundamentals?.revenue;
  return ev != null && revenue ? ev / revenue : undefined;
}

function fcfYield(financials: TickerFinancials | null): number | undefined {
  const fcf = financials?.fundamentals?.freeCashFlow;
  const marketCap = financials?.quote?.marketCap;
  return fcf != null && marketCap ? fcf / marketCap : undefined;
}

function RelativeValuationPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol } = useSymbolBinding();
  const symbols = useMemo(
    () => relativeSymbolsFromPane(symbol, pane?.settings),
    [pane?.settings, symbol],
  );
  const dataProvider = useMarketData();
  const { navigateTicker } = usePluginTickerActions();
  const [rows, setRows] = useState<RelativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const columns = useMemo(() => buildRelativeColumns(width), [width]);
  const fetchGenRef = useRef(0);

  const reload = useCallback((forceRefresh = false) => {
    if (symbols.length === 0) {
      setRows([]);
      setError("No tickers selected");
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    Promise.all(symbols.map(async (nextSymbol): Promise<RelativeRow> => {
      try {
        const financials = await dataProvider.getTickerFinancials(nextSymbol, "", forceRefresh ? { cacheMode: "refresh" } : undefined);
        return { symbol: nextSymbol, financials };
      } catch (err) {
        return { symbol: nextSymbol, financials: null, error: err instanceof Error ? err.message : String(err) };
      }
    }))
      .then((nextRows) => {
        if (fetchGenRef.current !== gen) return;
        setRows(nextRows);
      })
      .catch((err) => {
        if (fetchGenRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (fetchGenRef.current === gen) setLoading(false);
      });
  }, [dataProvider, symbols]);

  useEffect(() => {
    reload(false);
  }, [reload]);

  useEffect(() => {
    if (selectedIdx >= rows.length) setSelectedIdx(Math.max(0, rows.length - 1));
  }, [rows.length, selectedIdx]);

  const renderCell = useCallback((row: RelativeRow, column: RelativeColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const quote = row.financials?.quote;
    const fundamentals = row.financials?.fundamentals;
    switch (column.id) {
      case "symbol":
        return { text: row.symbol, color: selectedColor ?? (row.error ? colors.warning : colors.textBright), attributes: TextAttributes.BOLD };
      case "price":
        return { text: quote?.price != null ? formatCurrency(quote.price, quote.currency) : "-", color: selectedColor ?? colors.text };
      case "change":
        return { text: quote?.changePercent != null ? formatPercentRaw(quote.changePercent) : "-", color: selectedColor ?? priceColor(quote?.changePercent ?? 0) };
      case "marketCap":
        return { text: formatCompact(quote?.marketCap), color: selectedColor ?? colors.textDim };
      case "pe":
        return { text: formatNumber(fundamentals?.trailingPE, 1), color: selectedColor ?? colors.text };
      case "forwardPe":
        return { text: formatNumber(fundamentals?.forwardPE, 1), color: selectedColor ?? colors.text };
      case "evSales":
        return { text: formatNumber(evSales(row.financials), 1), color: selectedColor ?? colors.text };
      case "fcfYield":
        return { text: formatPercent(fcfYield(row.financials)), color: selectedColor ?? priceColor(fcfYield(row.financials) ?? 0) };
      case "revenueGrowth":
        return { text: formatPercent(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth), color: selectedColor ?? priceColor(fundamentals?.revenueGrowth ?? fundamentals?.lastQuarterGrowth ?? 0) };
      case "margin":
        return { text: formatPercent(fundamentals?.operatingMargin), color: selectedColor ?? colors.text };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload(true);
    return true;
  }, [reload]);

  usePaneFooter("relative-valuation", () => ({
    info: [
      { id: "tickers", parts: [{ text: `${symbols.length} tickers`, tone: symbols.length > 0 ? "value" as const : "muted" as const }] },
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: () => reload(true) }],
  }), [error, loading, reload, symbols.length]);

  return (
    <DataTableView<RelativeRow, RelativeColumn>
      focused={focused}
      selectedIndex={rows.length > 0 ? selectedIdx : -1}
      onSelectIndex={(index) => setSelectedIdx(index)}
      onActivateIndex={(_index, row) => navigateTicker(row.symbol)}
      onRootKeyDown={handleKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.symbol}
      isSelected={(row) => rows[selectedIdx]?.symbol === row.symbol}
      onSelect={(row, index) => {
        setSelectedIdx(index);
        navigateTicker(row.symbol);
      }}
      renderCell={renderCell}
      emptyStateTitle={loading ? "Loading peers..." : error ?? "No peers"}
    />
  );
}

function ResearchPane({ focused, width, height }: PaneProps) {
  return <AnalystResearchView focused={focused} width={width} height={height} />;
}

function EventsPane({ focused, width, height }: PaneProps) {
  return <CorporateActionsView focused={focused} width={width} height={height} />;
}

function AnalystTab({ focused, width, height }: DetailTabProps) {
  return <AnalystResearchView focused={focused} width={width} height={height} />;
}

function EventsTab({ focused, width, height }: DetailTabProps) {
  return <CorporateActionsView focused={focused} width={width} height={height} />;
}

function createTickerBoundPane(contextTicker: string | null, arg: string | undefined, titlePrefix: string) {
  const ticker = normalizeTickerInput(contextTicker, arg);
  return ticker
    ? {
        title: `${titlePrefix} ${ticker}`,
        binding: { kind: "fixed" as const, symbol: ticker },
        placement: "floating" as const,
      }
    : null;
}

export const researchPlugin: GloomPlugin = {
  id: "research",
  name: "Research",
  version: "1.0.0",
  description: "Analyst research, corporate actions, and relative valuation",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "analyst-research",
      name: "Analyst",
      order: 32,
      component: AnalystTab,
      isVisible: ({ ticker }) => !!ticker,
    });
    ctx.registerDetailTab({
      id: "corporate-actions",
      name: "Events",
      order: 34,
      component: EventsTab,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  panes: [
    {
      id: "analyst-research",
      name: "Analyst Research",
      icon: "A",
      component: ResearchPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 28 },
    },
    {
      id: "corporate-actions",
      name: "Corporate Actions",
      icon: "E",
      component: EventsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 82, height: 24 },
    },
    {
      id: "relative-valuation",
      name: "Relative Valuation",
      icon: "R",
      component: RelativeValuationPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 24 },
    },
  ],

  paneTemplates: [
    {
      id: "analyst-research-pane",
      paneId: "analyst-research",
      label: "Analyst Research",
      description: "Price targets, recommendations, and recent analyst actions.",
      keywords: ["analyst", "research", "ratings", "target", "anr"],
      shortcut: { prefix: "ANR", argPlaceholder: "ticker", argKind: "ticker" },
      canCreate: (context, options) => (options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg)) !== null,
      createInstance: (context, options) => createTickerBoundPane(options?.symbol ?? context.activeTicker, options?.arg, "Analyst"),
    },
    {
      id: "corporate-actions-pane",
      paneId: "corporate-actions",
      label: "Corporate Actions",
      description: "Dividends, splits, and recent earnings.",
      keywords: ["events", "corporate", "actions", "dividend", "split", "earnings", "evt"],
      shortcut: { prefix: "EVT", argPlaceholder: "ticker", argKind: "ticker" },
      canCreate: (context, options) => (options?.symbol ?? normalizeTickerInput(context.activeTicker, options?.arg)) !== null,
      createInstance: (context, options) => createTickerBoundPane(options?.symbol ?? context.activeTicker, options?.arg, "Events"),
    },
    {
      id: "relative-valuation-pane",
      paneId: "relative-valuation",
      label: "Relative Valuation",
      description: "Compare valuation and operating metrics across peers.",
      keywords: ["relative", "valuation", "comps", "peers", "rv"],
      shortcut: { prefix: "RV", argPlaceholder: "tickers", argKind: "ticker-list" },
      canCreate: (context, options) => !!(options?.symbols?.length || options?.arg || context.activeTicker),
      createInstance: (context, options) => {
        let symbols: string[];
        try {
          symbols = options?.symbols?.length
            ? options.symbols
            : parseTickerListInput(options?.arg ?? context.activeTicker ?? "", 12);
        } catch {
          return null;
        }
        return {
          title: `RV ${formatTickerListInput(symbols)}`,
          placement: "floating",
          settings: { symbols, symbolsText: formatTickerListInput(symbols) },
        };
      },
    },
  ],
};
