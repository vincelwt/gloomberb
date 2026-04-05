import type { CommandBarFieldValue, CommandBarWorkflowField } from "../../../components/command-bar/workflow-types";
import type { AppConfig } from "../../../types/config";
import type { TickerRecord } from "../../../types/ticker";
import { getManualPortfolioPosition, isManualPortfolio } from "./mutations";

export interface SetPortfolioPositionWorkflowState {
  fields: CommandBarWorkflowField[];
  values: Record<string, CommandBarFieldValue>;
  pendingLabel: string;
}

export function buildSetPortfolioPositionWorkflow(
  config: AppConfig,
  options: {
    activeCollectionId: string | null;
    activeTicker: TickerRecord | null;
  },
): SetPortfolioPositionWorkflowState | null {
  const manualPortfolios = config.portfolios.filter(isManualPortfolio);
  if (manualPortfolios.length === 0) return null;

  const preferredPortfolio = manualPortfolios.find((portfolio) => portfolio.id === options.activeCollectionId) ?? manualPortfolios[0]!;
  const preferredPosition = options.activeTicker
    ? getManualPortfolioPosition(options.activeTicker, preferredPortfolio.id)
    : null;

  const fields: CommandBarWorkflowField[] = [
    {
      id: "portfolioId",
      label: "Portfolio",
      type: "select",
      options: manualPortfolios.map((portfolio) => ({
        label: portfolio.name,
        value: portfolio.id,
        description: portfolio.currency,
      })),
      required: true,
    },
    {
      id: "ticker",
      label: "Ticker",
      type: "text",
      placeholder: "AAPL",
      required: true,
    },
    {
      id: "shares",
      label: "Shares",
      type: "number",
      placeholder: "10",
      required: true,
    },
    {
      id: "avgCost",
      label: "Avg Cost",
      type: "number",
      placeholder: "180",
      required: true,
    },
    {
      id: "currency",
      label: "Currency",
      type: "text",
      placeholder: preferredPortfolio.currency,
      required: false,
    },
  ];

  const values: Record<string, CommandBarFieldValue> = {
    portfolioId: preferredPortfolio.id,
    ticker: options.activeTicker?.metadata.ticker ?? "",
    shares: preferredPosition ? String(preferredPosition.shares) : "",
    avgCost: preferredPosition ? String(preferredPosition.avgCost) : "",
    currency: preferredPosition?.currency ?? "",
  };

  return {
    fields,
    values,
    pendingLabel: "Saving position…",
  };
}
