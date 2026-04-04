import { TextAttributes } from "@opentui/core";
import { colors } from "../../../theme/colors";
import { padTo } from "../../../utils/format";
import {
  formatPredictionMetric,
  formatPredictionPercent,
  getPredictionProbabilityColor,
} from "../metrics";
import type { PredictionListRow } from "../types";
import { sortPredictionOutcomeMarkets } from "../outcome-order";

export function PredictionMarketOutcomesView({
  detailWidth,
  onSelectMarket,
  selectedMarketKey,
  selectedRow,
}: {
  detailWidth: number;
  onSelectMarket: (marketKey: string) => void;
  selectedMarketKey: string;
  selectedRow: PredictionListRow;
}) {
  if (selectedRow.kind !== "group") return null;

  const sortedOutcomes = sortPredictionOutcomeMarkets(selectedRow.markets);
  const labelWidth = Math.max(detailWidth - 22, 12);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          Outcomes
        </text>
      </box>

      <box flexDirection="row" height={1}>
        <box width={labelWidth + 1}>
          <text fg={colors.textDim}>{padTo("TARGET", labelWidth)}</text>
        </box>
        <box width={8}>
          <text fg={colors.textDim}>{padTo("ODDS", 7, "right")}</text>
        </box>
        <box width={13}>
          <text fg={colors.textDim}>{padTo("24H VOL", 12, "right")}</text>
        </box>
      </box>

      {sortedOutcomes.map((market, index) => {
        const selected = market.key === selectedMarketKey;
        return (
          <box
            key={market.key}
            flexDirection="row"
            height={1}
            backgroundColor={selected ? colors.selected : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelectMarket(market.key);
            }}
          >
            <box width={labelWidth + 1}>
              <text
                fg={selected ? colors.selectedText : colors.text}
                attributes={selected ? TextAttributes.BOLD : 0}
              >
                {padTo(market.marketLabel, labelWidth)}
              </text>
            </box>
            <box width={8}>
              <text
                fg={
                  selected
                    ? colors.selectedText
                    : getPredictionProbabilityColor(market.yesPrice) ??
                      colors.text
                }
              >
                {padTo(formatPredictionPercent(market.yesPrice), 7, "right")}
              </text>
            </box>
            <box width={13}>
              <text fg={selected ? colors.selectedText : colors.textDim}>
                {padTo(
                  formatPredictionMetric(
                    market.volume24h,
                    market.volume24hUnit,
                  ),
                  12,
                  "right",
                )}
              </text>
            </box>
          </box>
        );
      })}
    </box>
  );
}
