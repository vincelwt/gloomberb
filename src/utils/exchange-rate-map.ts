export function selectEffectiveExchangeRates(
  fetchedRates: Map<string, number>,
  persistedRates: Map<string, number>,
): Map<string, number> {
  return fetchedRates.size > 1 || persistedRates.size === 0
    ? fetchedRates
    : persistedRates;
}
