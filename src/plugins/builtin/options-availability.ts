import { useEffect, useMemo, useRef, useState } from "react";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import type { DataProvider } from "../../types/data-provider";
import type { TickerRecord } from "../../types/ticker";
import type { ResolvedOptionsTarget } from "../../utils/options";
import { resolveOptionsTarget } from "../../utils/options";

export const OPTIONS_AVAILABILITY_TTL_MS = 5 * 60_000;

const EXPECTED_OPTIONS_MISS = /no data found|symbol may be delisted|not found|no options|no provider available/i;

type OptionsAvailabilityRecord = {
  available: boolean;
  checkedAt: number;
};

const optionsAvailabilityCache = new Map<string, OptionsAvailabilityRecord>();
const optionsAvailabilityInFlight = new Map<string, Promise<boolean>>();

function getRequestContext(target: ResolvedOptionsTarget) {
  return {
    brokerId: target.instrument?.brokerId,
    brokerInstanceId: target.instrument?.brokerInstanceId,
    instrument: target.instrument,
  };
}

function isCacheFresh(record: OptionsAvailabilityRecord | undefined, now: number): record is OptionsAvailabilityRecord {
  return !!record && (now - record.checkedAt) < OPTIONS_AVAILABILITY_TTL_MS;
}

export function readOptionsAvailability(
  targetOrKey: ResolvedOptionsTarget | string,
  now = Date.now(),
): boolean | null {
  const key = typeof targetOrKey === "string" ? targetOrKey : targetOrKey.cacheKey;
  const record = optionsAvailabilityCache.get(key);
  return isCacheFresh(record, now) ? record.available : null;
}

export function setOptionsAvailability(
  targetOrKey: ResolvedOptionsTarget | string,
  available: boolean,
  checkedAt = Date.now(),
): void {
  const key = typeof targetOrKey === "string" ? targetOrKey : targetOrKey.cacheKey;
  optionsAvailabilityCache.set(key, { available, checkedAt });
}

export function resetOptionsAvailabilityCache(): void {
  optionsAvailabilityCache.clear();
  optionsAvailabilityInFlight.clear();
}

export async function fetchOptionsAvailability(
  target: ResolvedOptionsTarget,
  provider?: DataProvider,
): Promise<boolean> {
  const cached = readOptionsAvailability(target);
  if (cached != null) return cached;

  if (!target.effectiveTicker) {
    setOptionsAvailability(target, false);
    return false;
  }

  const existing = optionsAvailabilityInFlight.get(target.cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      if (provider?.getOptionsChain) {
        const chain = await provider.getOptionsChain(
          target.effectiveTicker,
          target.effectiveExchange,
          undefined,
          getRequestContext(target),
        );
        const available = chain.expirationDates.length > 0;
        setOptionsAvailability(target, available);
        return available;
      }

      const coordinator = getSharedMarketDataCoordinator();
      if (!coordinator) {
        setOptionsAvailability(target, false);
        return false;
      }
      const entry = await coordinator.loadOptions({
        instrument: {
          symbol: target.effectiveTicker,
          exchange: target.effectiveExchange,
          brokerId: target.instrument?.brokerId,
          brokerInstanceId: target.instrument?.brokerInstanceId,
          instrument: target.instrument,
        },
      });
      const chain = entry.data ?? entry.lastGoodData;
      if (!chain) {
        setOptionsAvailability(target, false);
        return false;
      }
      const available = chain.expirationDates.length > 0;
      setOptionsAvailability(target, available);
      return available;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (!EXPECTED_OPTIONS_MISS.test(message)) {
        setOptionsAvailability(target, false);
        return false;
      }
      setOptionsAvailability(target, false);
      return false;
    }
  })().finally(() => {
    optionsAvailabilityInFlight.delete(target.cacheKey);
  });

  optionsAvailabilityInFlight.set(target.cacheKey, request);
  return request;
}

export function useOptionsAvailability(ticker: TickerRecord | null | undefined): boolean {
  const target = useMemo(() => resolveOptionsTarget(ticker), [
    ticker?.metadata.ticker,
    ticker?.metadata.exchange,
    ticker?.metadata.assetCategory,
    ticker?.metadata.broker_contracts?.[0]?.brokerInstanceId,
    ticker?.metadata.broker_contracts?.[0]?.conId,
  ]);
  const [available, setAvailable] = useState(() => (target ? readOptionsAvailability(target) ?? false : false));
  const requestRef = useRef(0);

  useEffect(() => {
    if (!target) {
      requestRef.current += 1;
      setAvailable(false);
      return;
    }

    const cached = readOptionsAvailability(target);
    if (cached != null) {
      requestRef.current += 1;
      setAvailable(cached);
      return;
    }

    setAvailable(false);
    const requestId = ++requestRef.current;
    void fetchOptionsAvailability(target).then((result) => {
      if (requestRef.current === requestId) {
        setAvailable(result);
      }
    });
  }, [target?.cacheKey]);

  return available;
}
