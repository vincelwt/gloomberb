import { PaneFooterScope } from "../../../../components";
import type { PaneProps, TickerResearchTabProps } from "../../../../types/plugin";
import { usePaneTicker } from "../../../../state/app/context";
import { ResolvedFinancialsTab } from "./tab";

export function FinancialsResearchTab({ focused }: TickerResearchTabProps) {
  const { financials } = usePaneTicker();
  return (
    <ResolvedFinancialsTab
      focused={focused}
      financials={financials}
    />
  );
}

export function FinancialAnalysisPane({ focused }: PaneProps) {
  const { financials } = usePaneTicker();
  return (
    <PaneFooterScope active>
      <ResolvedFinancialsTab
        focused={focused}
        financials={financials}
      />
    </PaneFooterScope>
  );
}
