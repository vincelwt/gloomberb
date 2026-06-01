import type { ChoiceDialogChoice } from "../../../components";
import type { AccountProfile } from "../../../api-client";
import type { Portfolio, TickerRecord } from "../../../types/ticker";

export type AccountFieldKey =
  | "username"
  | "name"
  | "company"
  | "title"
  | "bio"
  | "profilePublic"
  | "publicEmail"
  | "xAccount"
  | "acceptUnknownDms"
  | "sharedPortfolioId"
  | "passwordAction";

export interface AccountDraft {
  username: string;
  name: string;
  company: string;
  title: string;
  bio: string;
  profilePublic: boolean;
  publicEmail: string;
  xAccount: string;
  sharedPortfolioId: string;
  acceptUnknownDms: boolean;
}

export const BASE_FIELD_ORDER: AccountFieldKey[] = [
  "username",
  "name",
  "company",
  "title",
  "bio",
  "profilePublic",
  "publicEmail",
  "xAccount",
  "acceptUnknownDms",
  "sharedPortfolioId",
  "passwordAction",
];

export const NO_PORTFOLIO_VALUE = "__none__";

export function profileToDraft(profile: AccountProfile | null): AccountDraft {
  return {
    username: profile?.username ?? "",
    name: profile?.name ?? "",
    company: profile?.company ?? "",
    title: profile?.title ?? "",
    bio: profile?.bio ?? "",
    profilePublic: profile?.profilePublic === true,
    publicEmail: profile?.publicEmail ?? "",
    xAccount: profile?.xAccount ?? "",
    sharedPortfolioId: profile?.sharedPortfolioId ?? "",
    acceptUnknownDms: profile?.acceptUnknownDms === true,
  };
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function formatPlan(plan: AccountProfile["plan"] | null | undefined): string {
  return plan === "pro" ? "Pro" : "Free";
}

export function countPortfolioHoldings(tickers: ReadonlyMap<string, TickerRecord>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of tickers.values()) {
    for (const portfolioId of record.metadata.portfolios) {
      counts[portfolioId] = (counts[portfolioId] ?? 0) + 1;
    }
  }
  return counts;
}

export function buildPortfolioChoices(portfolios: Portfolio[], holdingCounts: Record<string, number>): ChoiceDialogChoice[] {
  return [
    { id: NO_PORTFOLIO_VALUE, label: "None", detail: "Off", description: "Do not show portfolio analytics on your public profile." },
    ...portfolios.map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.name,
      detail: `${holdingCounts[portfolio.id] ?? 0} tickers`,
      description: "Shares this portfolio's YTD % and SPY Beta on your public profile.",
    })),
  ];
}

export function portfolioOptionIds(portfolios: Portfolio[]): string[] {
  return [NO_PORTFOLIO_VALUE, ...portfolios.map((portfolio) => portfolio.id)];
}

export function selectedPortfolioLabel(portfolios: Portfolio[], value: string): string {
  if (!value) return "None";
  return portfolios.find((portfolio) => portfolio.id === value)?.name ?? value;
}
