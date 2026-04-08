import type { TimeRange } from "../components/chart/chart-types";
import type { ManualChartResolution } from "../components/chart/chart-resolution";
import type { QuoteSubscriptionTarget } from "../types/data-provider";
import type { BrokerContractRef } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";

export interface InstrumentRef {
  symbol: string;
  exchange?: string;
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}

export type ChartGranularity = "range" | "detail" | "resolution";

export interface ChartRequest {
  instrument: InstrumentRef;
  bufferRange: TimeRange;
  granularity?: ChartGranularity;
  resolution?: ManualChartResolution;
  startDate?: Date;
  endDate?: Date;
  barSize?: string;
}

export interface NewsRequest {
  instrument: InstrumentRef;
  count?: number;
}

export interface OptionsRequest {
  instrument: InstrumentRef;
  expirationDate?: number;
}

export interface SecFilingsRequest {
  instrument: InstrumentRef;
  count?: number;
}

export function instrumentFromTicker(ticker: TickerRecord | null | undefined, fallbackSymbol?: string | null): InstrumentRef | null {
  const symbol = ticker?.metadata.ticker ?? fallbackSymbol ?? null;
  if (!symbol) return null;
  const instrument = ticker?.metadata.broker_contracts?.[0] ?? null;
  return {
    symbol,
    exchange: ticker?.metadata.exchange ?? "",
    brokerId: instrument?.brokerId,
    brokerInstanceId: instrument?.brokerInstanceId,
    instrument,
  };
}

export function quoteSubscriptionTargetFromTicker(
  ticker: TickerRecord | null | undefined,
  fallbackSymbol?: string | null,
  route: QuoteSubscriptionTarget["route"] = "auto",
): QuoteSubscriptionTarget | null {
  const instrument = instrumentFromTicker(ticker, fallbackSymbol);
  if (!instrument) return null;
  return {
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    route,
    context: {
      brokerId: instrument.brokerId,
      brokerInstanceId: instrument.brokerInstanceId,
      instrument: instrument.instrument ?? null,
    },
  };
}
