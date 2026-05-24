import type { TickerResearchTabProps } from "../../../../types/plugin";
import { usePaneTicker } from "../../../../state/app/context";
import { OverviewTab } from "../overview-tab";

export function OverviewResearchTab({ width }: TickerResearchTabProps) {
  const { ticker, financials } = usePaneTicker();
  return (
    <OverviewTab
      width={width}
      ticker={ticker}
      financials={financials}
    />
  );
}
