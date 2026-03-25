import type { DataProvider } from "../types/data-provider";

/** Convert a value from one currency to the base currency */
export async function convertToBase(
  value: number,
  fromCurrency: string,
  baseCurrency: string,
  dataProvider: DataProvider,
): Promise<number> {
  if (fromCurrency === baseCurrency) return value;

  // Convert: fromCurrency -> USD -> baseCurrency
  const fromToUsd = await dataProvider.getExchangeRate(fromCurrency);
  const baseToUsd = await dataProvider.getExchangeRate(baseCurrency);

  if (baseToUsd === 0) return value;
  return (value * fromToUsd) / baseToUsd;
}
