import { describe, expect, test } from "bun:test";
import type { QueryEntry } from "../../../../market-data/result-types";
import type { PricePoint } from "../../../../types/financials";
import { resolveStockChartRender } from "./state";

function readyEntry(data: PricePoint[]): QueryEntry<PricePoint[]> {
  return {
    phase: "ready",
    data,
    lastGoodData: data,
    source: "test",
    fetchedAt: Date.now(),
    staleAt: null,
    error: null,
    attempts: [],
  };
}

describe("resolveStockChartRender", () => {
  test("uses compatible bounds data instead of showing an empty manual candidate", () => {
    const boundsHistory: PricePoint[] = [
      { date: new Date("2026-05-20T00:00:00Z"), close: 100 },
      { date: new Date("2026-05-21T00:00:00Z"), close: 101 },
      { date: new Date("2026-05-22T00:00:00Z"), close: 102 },
    ];

    const resolved = resolveStockChartRender({
      boundsBodyState: {
        data: boundsHistory,
        blocking: false,
        updating: false,
        emptyMessage: null,
        errorMessage: null,
      },
      boundsHistory,
      boundsHistoryCompatible: true,
      candidateDetailEntries: new Map(),
      candidateResolutionEntries: new Map([["candidate", readyEntry([])]]),
      compact: false,
      effectiveResolution: "1d",
      fallbackPriceHistory: [],
      historyOverride: null,
      plannedDateWindow: {
        start: boundsHistory[0]!.date,
        end: boundsHistory[2]!.date,
      },
      plannedManualResolution: "1d",
      renderedAutoView: null,
      renderedAutoViewAccepted: false,
      renderCandidates: [{
        resolution: "1d",
        plan: {
          effectiveResolution: "1d",
          requestedWindow: {
            start: boundsHistory[0]!.date,
            end: boundsHistory[2]!.date,
          },
          resolutionRequest: {} as never,
          detailRequest: null,
          unsupportedMessage: null,
        },
        resolutionRequestKey: "candidate",
        detailRequestKey: null,
      }],
    });

    expect(resolved.bodyState.data).toBe(boundsHistory);
    expect(resolved.bodyState.emptyMessage).toBeNull();
  });
});
