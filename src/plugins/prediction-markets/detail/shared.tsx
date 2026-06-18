import { Box } from "../../../ui";
import { colors } from "../../../theme/colors";
import { ExternalLinkText } from "../../../components/ui/external-link";
import type {
  PredictionListRow,
  PredictionMarketDetail,
  PredictionMarketSummary,
} from "../types";

export function truncatePredictionText(
  value: string,
  maxLength: number,
): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

export function resolvePredictionDetailTitle({
  detail,
  selectedRow,
  selectedSummary,
}: {
  detail: PredictionMarketDetail | null;
  selectedRow: PredictionListRow | null;
  selectedSummary: PredictionMarketSummary | null;
}): string | undefined {
  if (!selectedSummary) return undefined;
  const summary = detail?.summary ?? selectedSummary;
  return selectedRow?.kind === "group" ? selectedRow.title : summary.title;
}

export function SummaryLink({
  url,
  maxLength,
}: {
  url: string;
  maxLength: number;
}) {
  return (
    <Box height={1}>
      <ExternalLinkText
        url={url}
        label={truncatePredictionText(url, maxLength)}
        color={colors.textBright}
      />
    </Box>
  );
}
