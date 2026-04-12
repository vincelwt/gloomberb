export const MAJOR_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"] as const;
export type MajorCurrency = typeof MAJOR_CURRENCIES[number];

export const CURRENCY_LABELS: Record<MajorCurrency, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CHF: "Swiss Franc",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  NZD: "New Zealand Dollar",
};

export const CURRENCY_FLAGS: Record<MajorCurrency, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CHF: "🇨🇭",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  NZD: "🇳🇿",
};

/** Format rate with appropriate precision — JPY pairs get 2 decimals, others get 4 */
export function formatRate(rate: number, toCurrency: MajorCurrency): string {
  const decimals = toCurrency === "JPY" ? 2 : 4;
  return rate.toFixed(decimals);
}
