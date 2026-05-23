import { useMemo } from "react";
import type { PaneProps, PaneTemplateDef } from "../../../../types/plugin";
import { formatTickerListInput } from "../../../../utils/ticker-list";
import { usePaneInstance, usePaneTicker } from "../../../../state/app-context";
import { usePluginPaneState } from "../../../plugin-runtime";
import { useBoundTicker } from "../../shared/ticker-request";
import { FundamentalGraphContent } from "./fundamental-graph/content";
import { useSymbolFinancials } from "./fundamental-graph/data";
import {
  defaultMetric,
  graphRowsForFinancials,
  isMetricForKind,
} from "./fundamental-graph/model";
import {
  graphKindFromSettings,
  graphTemplateSymbols,
  graphTemplateTitle,
  symbolsFromPaneSettings,
} from "./fundamental-graph/settings";
import type { FundamentalPeriod, GraphKind, GraphMetricKey } from "./fundamental-graph/types";

export { buildFundamentalGraphRows, buildValuationGraphRows } from "./fundamental-graph/model";

export function FundamentalGraphPane({ focused, width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { symbol, exchange } = useBoundTicker();
  const symbols = useMemo(() => symbolsFromPaneSettings(pane?.settings, symbol), [pane?.settings, symbol]);
  const configuredKind = graphKindFromSettings(pane?.settings, "fundamental");
  const [period, setPeriod] = usePluginPaneState<FundamentalPeriod>("period", "annual");
  const [chartKind, setChartKind] = usePluginPaneState<GraphKind>("chartKind", configuredKind);
  const [metric, setMetric] = usePluginPaneState<GraphMetricKey>("metric", defaultMetric(configuredKind));
  const resolvedMetric = isMetricForKind(chartKind, metric) ? metric : defaultMetric(chartKind);
  const { data, loading, error, reload } = useSymbolFinancials(symbols, exchange);
  const rows = useMemo(() => (data ?? []).flatMap((entry) => (
    graphRowsForFinancials(entry.financials, chartKind, resolvedMetric, period, entry.symbol)
  )), [chartKind, data, period, resolvedMetric]);

  return (
    <FundamentalGraphContent
      focused={focused}
      width={width}
      height={height}
      rows={rows}
      loading={loading}
      error={error}
      reload={reload}
      period={period}
      setPeriod={setPeriod}
      metric={resolvedMetric}
      setMetric={setMetric}
      chartKind={chartKind}
      setChartKind={setChartKind}
    />
  );
}

export function FundamentalGraphsDetailTab({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { symbol, financials } = usePaneTicker();
  const [period, setPeriod] = usePluginPaneState<FundamentalPeriod>("detailPeriod", "annual");
  const [chartKind, setChartKind] = usePluginPaneState<GraphKind>("detailChartKind", "fundamental");
  const [metric, setMetric] = usePluginPaneState<GraphMetricKey>("detailMetric", "totalRevenue");
  const resolvedMetric = isMetricForKind(chartKind, metric) ? metric : defaultMetric(chartKind);
  const rows = useMemo(() => (
    graphRowsForFinancials(financials, chartKind, resolvedMetric, period, symbol ?? "")
  ), [chartKind, financials, period, resolvedMetric, symbol]);

  return (
    <FundamentalGraphContent
      focused={focused}
      width={width}
      height={height}
      rows={rows}
      loading={false}
      error={null}
      reload={() => {}}
      period={period}
      setPeriod={setPeriod}
      metric={resolvedMetric}
      setMetric={setMetric}
      chartKind={chartKind}
      setChartKind={setChartKind}
    />
  );
}

export function createGraphPaneTemplate({
  id,
  label,
  description,
  shortcut,
  chartKind,
}: {
  id: string;
  label: string;
  description: string;
  shortcut: "GF" | "GE";
  chartKind: GraphKind;
}): PaneTemplateDef {
  return {
    id,
    paneId: "fundamental-graph",
    label,
    description,
    keywords: chartKind === "valuation"
      ? ["valuation", "graph", "ge", "multiples", "pe", "sales"]
      : ["fundamental", "graph", "gf", "financials", "statements"],
    shortcut: { prefix: shortcut, argPlaceholder: "tickers", argKind: "ticker-list" as const },
    wizard: [
      {
        key: "tickers",
        label: "Tickers",
        placeholder: "AMD, NVDA",
        body: ["Enter one or more ticker symbols separated by commas."],
        type: "text" as const,
      },
    ],
    canCreate: (context, options) => graphTemplateSymbols(context.activeTicker, options).length > 0,
    createInstance: (context, options) => {
      const symbols = graphTemplateSymbols(context.activeTicker, options);
      const primarySymbol = symbols[0];
      return primarySymbol
        ? {
          title: graphTemplateTitle(shortcut, symbols),
          binding: { kind: "fixed" as const, symbol: primarySymbol },
          placement: "floating" as const,
          settings: {
            chartKind,
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        }
        : null;
    },
  };
}
