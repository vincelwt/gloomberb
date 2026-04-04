import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { Spinner, TabBar } from "../../../components";
import { EmptyState } from "../../../components/ui/status";
import { colors } from "../../../theme/colors";
import { padTo } from "../../../utils/format";
import { DETAIL_TABS } from "../navigation";
import {
  formatPredictionEndsAt,
  formatPredictionMetric,
  formatPredictionProbability,
  formatPredictionSpread,
  getPredictionProbabilityColor,
} from "../metrics";
import type {
  PredictionDetailTab,
  PredictionHistoryRange,
  PredictionListRow,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionOrderPreviewIntent,
} from "../types";
import { PredictionMarketBookView } from "./book";
import { PredictionMarketOverviewView } from "./overview";
import { PredictionMarketRulesView } from "./rules";
import { truncatePredictionText } from "./shared";
import { PredictionMarketTradesView } from "./trades";

interface MetricCell {
  label: string;
  value: string;
  width: number;
  color?: string;
}

function MetricLabelRow({ metrics }: { metrics: MetricCell[] }) {
  return (
    <box flexDirection="row" height={1}>
      {metrics.map((metric) => (
        <box key={metric.label} width={metric.width + 1}>
          <text fg={colors.textDim}>{padTo(metric.label, metric.width)}</text>
        </box>
      ))}
    </box>
  );
}

function MetricValueRow({ metrics }: { metrics: MetricCell[] }) {
  return (
    <box flexDirection="row" height={1}>
      {metrics.map((metric) => (
        <box key={metric.label} width={metric.width + 1}>
          <text
            fg={metric.color ?? colors.textBright}
            attributes={TextAttributes.BOLD}
          >
            {padTo(metric.value, metric.width)}
          </text>
        </box>
      ))}
    </box>
  );
}

export function PredictionMarketDetailPane({
  detail,
  detailError,
  detailLoadCount,
  detailTab,
  detailWidth,
  focused,
  height,
  historyRange,
  onDetailTabChange,
  onHistoryRangeChange,
  onPreviewOrder,
  onSelectMarket,
  selectedRow,
  selectedSummary,
  scrollRef,
}: {
  detail: PredictionMarketDetail | null;
  detailError: string | null;
  detailLoadCount: number;
  detailTab: PredictionDetailTab;
  detailWidth: number;
  focused: boolean;
  height: number;
  historyRange: PredictionHistoryRange;
  onDetailTabChange: (tab: PredictionDetailTab) => void;
  onHistoryRangeChange: (range: PredictionHistoryRange) => void;
  onPreviewOrder: (intent: PredictionOrderPreviewIntent) => void;
  onSelectMarket: (marketKey: string) => void;
  selectedRow: PredictionListRow | null;
  selectedSummary: PredictionMarketSummary | null;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  if (!selectedSummary) {
    return (
      <box flexGrow={1} justifyContent="center">
        <EmptyState
          title="Select a market."
          hint="Use the table on the left to inspect live prediction market detail."
        />
      </box>
    );
  }

  const summaryMetrics = detail?.summary ?? selectedSummary;
  const detailTitle =
    selectedRow?.kind === "group" ? selectedRow.title : summaryMetrics.title;
  const detailSubtitleParts: string[] = [];
  if (selectedRow?.kind === "group") {
    if (summaryMetrics.category) detailSubtitleParts.push(summaryMetrics.category);
  } else if (
    summaryMetrics.eventLabel &&
    summaryMetrics.eventLabel !== summaryMetrics.title
  ) {
    detailSubtitleParts.push(summaryMetrics.eventLabel);
  } else if (summaryMetrics.category) {
    detailSubtitleParts.push(summaryMetrics.category);
  }
  const endsLabel = formatPredictionEndsAt(
    selectedRow?.kind === "group" ? selectedRow.endsAt : summaryMetrics.endsAt,
  );
  if (endsLabel !== "—") detailSubtitleParts.push(endsLabel);
  const detailSubtitle = detailSubtitleParts.join(" · ");
  const primaryMetrics: MetricCell[] = [
    {
      label: "YES",
      value: formatPredictionProbability(summaryMetrics.yesPrice),
      color: getPredictionProbabilityColor(summaryMetrics.yesPrice),
      width: 12,
    },
    {
      label: "NO",
      value: formatPredictionProbability(summaryMetrics.noPrice),
      color: getPredictionProbabilityColor(summaryMetrics.noPrice),
      width: 12,
    },
    {
      label: "24H VOL",
      value: formatPredictionMetric(
        summaryMetrics.volume24h,
        summaryMetrics.volume24hUnit ?? "usd",
      ),
      width: 16,
    },
    {
      label: "TOTAL VOL",
      value: formatPredictionMetric(
        summaryMetrics.totalVolume,
        summaryMetrics.totalVolumeUnit ?? "usd",
      ),
      width: 16,
    },
  ];
  const secondaryMetrics: MetricCell[] = [
    {
      label: "OI",
      value: formatPredictionMetric(
        summaryMetrics.openInterest,
        summaryMetrics.openInterestUnit ?? "usd",
      ),
      width: 16,
    },
    {
      label: "SPREAD",
      value: formatPredictionSpread(summaryMetrics.spread),
      width: 16,
    },
    {
      label: "LAST",
      value: formatPredictionProbability(summaryMetrics.lastTradePrice),
      color: colors.textBright,
      width: 16,
    },
  ];
  const relatedSiblings =
    selectedRow?.kind === "group"
      ? []
      : (detail?.siblings
          ?.filter((sibling) => sibling.key !== selectedSummary.key)
          .slice(
            0,
            Math.max(Math.min(Math.floor((detailWidth - 10) / 18), 3), 0),
          ) ?? []);
  const headerHeight = detailSubtitle.length > 0 ? 3 : 2;
  const detailLoading = detailLoadCount > 0 && !detail;
  const titleColor = focused ? colors.textBright : colors.text;

  return (
    <>
      <box flexDirection="column" height={headerHeight} paddingBottom={1}>
        <box flexDirection="row" height={1}>
          <text fg={titleColor} attributes={TextAttributes.BOLD}>
            {detailTitle}
          </text>
        </box>
        {detailSubtitle.length > 0 && (
          <box flexDirection="row" height={1}>
            <text fg={colors.textDim}>{detailSubtitle}</text>
          </box>
        )}
      </box>

      <box flexDirection="column" height={4} paddingBottom={1}>
        <MetricLabelRow metrics={primaryMetrics} />
        <MetricValueRow metrics={primaryMetrics} />
        <MetricLabelRow metrics={secondaryMetrics} />
        <MetricValueRow metrics={secondaryMetrics} />
      </box>

      {relatedSiblings.length > 0 && (
        <box flexDirection="row" gap={1} height={1} paddingBottom={1}>
          <text fg={colors.textDim}>Related:</text>
          {relatedSiblings.map((sibling) => (
            <box
              key={sibling.key}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectMarket(sibling.key);
              }}
            >
              <text fg={colors.text}>
                {`${truncatePredictionText(sibling.label, 10)} ${formatPredictionProbability(sibling.yesPrice)}`}
              </text>
            </box>
          ))}
        </box>
      )}

      <box paddingBottom={1}>
        <TabBar
          tabs={DETAIL_TABS.map((tab) => ({
            label: tab.label,
            value: tab.value,
          }))}
          activeValue={detailTab}
          onSelect={(value) => onDetailTabChange(value as PredictionDetailTab)}
          compact
        />
      </box>

      {detailError && !detail && (
        <box paddingBottom={1}>
          <text fg={colors.negative}>{detailError}</text>
        </box>
      )}

      <scrollbox ref={scrollRef} flexGrow={1} scrollY>
        {detailLoading && (
          <box height={1} paddingBottom={1}>
            <Spinner label="Loading market detail..." />
          </box>
        )}
        {detailTab === "overview" && (
          <PredictionMarketOverviewView
            detail={detail}
            detailWidth={detailWidth}
            height={height}
            historyRange={historyRange}
            onHistoryRangeChange={onHistoryRangeChange}
            onSelectMarket={onSelectMarket}
            selectedRow={selectedRow}
            summary={summaryMetrics}
          />
        )}

        {detailTab === "book" && detail && (
          <PredictionMarketBookView
            detail={detail}
            onPreviewOrder={onPreviewOrder}
          />
        )}

        {detailTab === "trades" && (
          <PredictionMarketTradesView trades={detail?.trades ?? []} />
        )}

        {detailTab === "rules" && (
          <PredictionMarketRulesView rules={detail?.rules ?? []} />
        )}
      </scrollbox>
    </>
  );
}
