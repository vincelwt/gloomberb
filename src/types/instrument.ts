export interface BrokerContractRef {
  brokerId: string;
  brokerInstanceId?: string;
  conId?: number;
  symbol: string;
  localSymbol?: string;
  secType?: string;
  exchange?: string;
  primaryExchange?: string;
  currency?: string;
  lastTradeDateOrContractMonth?: string;
  right?: "C" | "P";
  strike?: number;
  multiplier?: string;
  tradingClass?: string;
}

export interface InstrumentSearchResult {
  providerId: string;
  brokerInstanceId?: string;
  brokerLabel?: string;
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  currency?: string;
  primaryExchange?: string;
  brokerContract?: BrokerContractRef;
}
