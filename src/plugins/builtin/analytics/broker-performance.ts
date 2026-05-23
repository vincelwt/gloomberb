import { useEffect, useMemo, useState } from "react";
import type { ProjectedChartPoint } from "../../../components/chart/chart-data";
import type { AppConfig, BrokerInstanceConfig } from "../../../types/config";
import type { BrokerPortfolioPerformance } from "../../../types/trading";
import type { Portfolio } from "../../../types/ticker";
import { usePluginBrokerActions } from "../../plugin-runtime";

export interface BrokerPerformanceState {
  loading: boolean;
  performance: BrokerPortfolioPerformance | null;
  error: string | null;
}

function findBrokerInstance(config: AppConfig, portfolio: Portfolio | null): BrokerInstanceConfig | null {
  if (!portfolio?.brokerInstanceId) return null;
  return config.brokerInstances.find((instance) => instance.id === portfolio.brokerInstanceId) ?? null;
}

function isConfiguredIbkrFlexProfile(instance: BrokerInstanceConfig): boolean {
  if (instance.brokerType !== "ibkr" || instance.enabled === false) return false;
  const config = instance.config ?? {};
  const flex = typeof config.flex === "object" && config.flex
    ? config.flex as Record<string, unknown>
    : {};
  const mode = instance.connectionMode ?? config.connectionMode;
  return mode === "flex"
    && typeof flex.token === "string"
    && flex.token.length > 0
    && typeof flex.queryId === "string"
    && flex.queryId.length > 0;
}

function findBrokerPerformanceCandidates(
  config: AppConfig,
  portfolio: Portfolio | null,
): BrokerInstanceConfig[] {
  const primary = findBrokerInstance(config, portfolio);
  if (!primary) return [];
  if (primary.brokerType !== "ibkr") return [primary];

  const candidates = [primary];
  for (const instance of config.brokerInstances) {
    if (instance.id === primary.id) continue;
    if (!isConfiguredIbkrFlexProfile(instance)) continue;
    candidates.push(instance);
  }
  return candidates;
}

function resolveBrokerAccountId(portfolio: Portfolio | null): string | null {
  if (portfolio?.brokerAccountId) return portfolio.brokerAccountId;
  const parts = portfolio?.id.split(":") ?? [];
  return parts[0] === "broker" && parts.length >= 3 ? parts.slice(2).join(":") : null;
}

export function performancePointValue(point: BrokerPortfolioPerformance["points"][number]): number | null {
  if (point.value != null && Number.isFinite(point.value)) return point.value;
  if (point.cumulativeReturn != null && Number.isFinite(point.cumulativeReturn)) return point.cumulativeReturn;
  return null;
}

export function buildPerformanceChartPoints(performance: BrokerPortfolioPerformance | null): ProjectedChartPoint[] {
  if (!performance) return [];
  return performance.points.flatMap((point) => {
    const value = performancePointValue(point);
    const date = new Date(point.date);
    if (value == null || !Number.isFinite(date.getTime())) return [];
    return [{
      date,
      open: value,
      high: value,
      low: value,
      close: value,
      volume: 0,
    }];
  });
}

export function useBrokerPortfolioPerformance(
  portfolio: Portfolio | null,
  config: AppConfig,
): BrokerPerformanceState {
  const { getBrokerAdapter } = usePluginBrokerActions();
  const brokerInstances = useMemo(() => findBrokerPerformanceCandidates(config, portfolio), [config, portfolio]);
  const accountId = useMemo(() => resolveBrokerAccountId(portfolio), [portfolio]);
  const [state, setState] = useState<BrokerPerformanceState>({
    loading: false,
    performance: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (brokerInstances.length === 0 || !accountId) {
      setState({ loading: false, performance: null, error: null });
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));
    void (async () => {
      let lastError: string | null = null;
      for (const brokerInstance of brokerInstances) {
        const broker = getBrokerAdapter(brokerInstance.brokerType);
        if (!broker?.getPortfolioPerformance) continue;
        try {
          const performance = await broker.getPortfolioPerformance(brokerInstance, accountId);
          if (performance && performance.points.length > 0) {
            if (!cancelled) {
              setState({ loading: false, performance, error: null });
            }
            return;
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!cancelled) {
        setState({
          loading: false,
          performance: null,
          error: lastError ?? "No IBKR portfolio history returned",
        });
      }
    })()
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            performance: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, brokerInstances, getBrokerAdapter]);

  return state;
}
