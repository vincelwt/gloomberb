import { useEffect, useMemo, useState } from "react";
import type { InstrumentRef } from "../../../market-data/request-types";
import type { DataProvider } from "../../../types/data-provider";
import {
  buildChartResolutionSupportMap,
  DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS,
  normalizeChartResolutionSupport,
  type ChartResolutionSupport,
} from "../chart-resolution";

export function useStockChartResolutionSupport({
  compact,
  dataProvider,
  instrumentRef,
}: {
  compact: boolean | undefined;
  dataProvider: DataProvider | null | undefined;
  instrumentRef: InstrumentRef | null;
}) {
  const [resolutionSupport, setResolutionSupport] = useState<ChartResolutionSupport[] | null>(null);
  const capabilityKey = instrumentRef ? [
    instrumentRef.symbol,
    instrumentRef.exchange ?? "",
    instrumentRef.brokerId ?? "",
    instrumentRef.brokerInstanceId ?? "",
    instrumentRef.instrument?.conId ?? "",
  ].join("|") : null;

  useEffect(() => {
    if (compact || !instrumentRef) {
      setResolutionSupport(null);
      return;
    }
    if (!dataProvider?.getChartResolutionSupport && !dataProvider?.getChartResolutionCapabilities) {
      setResolutionSupport(null);
      return;
    }

    let cancelled = false;
    setResolutionSupport(null);
    Promise.resolve(dataProvider.getChartResolutionSupport
      ? dataProvider.getChartResolutionSupport(
        instrumentRef.symbol,
        instrumentRef.exchange ?? "",
        {
          brokerId: instrumentRef.brokerId,
          brokerInstanceId: instrumentRef.brokerInstanceId,
          instrument: instrumentRef.instrument ?? null,
        },
      )
      : Promise.resolve(dataProvider.getChartResolutionCapabilities?.(
          instrumentRef.symbol,
          instrumentRef.exchange ?? "",
          {
            brokerId: instrumentRef.brokerId,
            brokerInstanceId: instrumentRef.brokerInstanceId,
            instrument: instrumentRef.instrument ?? null,
          },
        ) ?? []).then((capabilities) => normalizeChartResolutionSupport(
          capabilities.map((resolution) => ({ resolution, maxRange: "ALL" })),
        ))
    ).then((support) => {
      if (!cancelled) {
        setResolutionSupport(support);
      }
    }).catch(() => {
      if (!cancelled) {
        setResolutionSupport(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capabilityKey, compact, dataProvider, instrumentRef]);

  const effectiveResolutionSupport = useMemo<ChartResolutionSupport[]>(() => (
    resolutionSupport ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS.map((resolution) => ({ resolution, maxRange: "ALL" as const }))
  ), [resolutionSupport]);
  const supportMap = useMemo(() => buildChartResolutionSupportMap(resolutionSupport ?? []), [resolutionSupport]);
  const selectionSupportMap = useMemo(
    () => buildChartResolutionSupportMap(effectiveResolutionSupport),
    [effectiveResolutionSupport],
  );
  const availableManualResolutions = resolutionSupport?.map((entry) => entry.resolution) ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS;
  const hasResolutionSupportApi = !!dataProvider?.getChartResolutionSupport || !!dataProvider?.getChartResolutionCapabilities;

  return {
    availableManualResolutions,
    effectiveResolutionSupport,
    hasResolutionSupportApi,
    resolutionSupport,
    selectionSupportMap,
    supportMap,
  };
}
