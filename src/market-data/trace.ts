import { debugLog } from "../utils/debug-log";

const marketDataLog = debugLog.createLogger("market-data");

export function traceMarketData(event: string, payload: Record<string, unknown>): void {
  marketDataLog.info(event, payload);
}
