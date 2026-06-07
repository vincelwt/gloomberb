import { useMemo } from "react";
import { useTickerFinancialsMap } from "../../../market-data/hooks";
import { useAppSelector } from "../../../state/app/context";
import type { ChartRendererPreference } from "../core/types";
import type { ComparisonChartSymbolSource } from "./render-data";

export function useComparisonChartSymbolSources(symbols: string[]): {
  defaultRenderMode: string | undefined;
  preferredRenderer: ChartRendererPreference;
  stableSymbols: string[];
  symbolSources: ComparisonChartSymbolSource[];
} {
  const tickers = useAppSelector((state) => state.tickers);
  const financials = useAppSelector((state) => state.financials);
  const chartPreferences = useAppSelector((state) => state.config.chartPreferences);
  const symbolsKey = symbols.join("|");
  const stableSymbols = useMemo(() => symbols, [symbolsKey]);
  const stableTickers = useMemo(() => (
    stableSymbols.flatMap((symbol) => {
      const ticker = tickers.get(symbol);
      return ticker ? [ticker] : [];
    })
  ), [stableSymbols, tickers]);
  const marketFinancials = useTickerFinancialsMap(stableTickers);
  const symbolSources = useMemo<ComparisonChartSymbolSource[]>(() => stableSymbols.map((symbol) => {
    const ticker = tickers.get(symbol) ?? null;
    const marketFinancial = marketFinancials.get(symbol) ?? null;
    const storedFinancial = financials.get(symbol) ?? null;
    const instrument = ticker?.metadata.broker_contracts?.[0] ?? null;
    const quote = marketFinancial?.quote ?? storedFinancial?.quote;
    return {
      symbol,
      currency: quote?.currency ?? ticker?.metadata.currency,
      quote,
      exchange: ticker?.metadata.exchange ?? "",
      brokerId: instrument?.brokerId,
      brokerInstanceId: instrument?.brokerInstanceId,
      instrument,
      priceHistory: marketFinancial?.priceHistory?.length
        ? marketFinancial.priceHistory
        : storedFinancial?.priceHistory ?? [],
    };
  }), [financials, marketFinancials, stableSymbols, tickers]);

  return {
    defaultRenderMode: chartPreferences.defaultRenderMode,
    preferredRenderer: chartPreferences.renderer,
    stableSymbols,
    symbolSources,
  };
}
