import type { Portfolio } from "../../../types/ticker";

export function resolvePortfolioId(portfolios: Portfolio[], portfolioId: string | null | undefined): string | null {
  if (!portfolioId) return null;
  return portfolios.some((portfolio) => portfolio.id === portfolioId) ? portfolioId : null;
}

export function resolveTemplatePortfolioId(portfolios: Portfolio[], activeCollectionId: string | null): string | null {
  return resolvePortfolioId(portfolios, activeCollectionId) ?? portfolios[0]?.id ?? null;
}
