const PROVIDER_MISS_BRAND = Symbol("provider-miss");
const EXPECTED_PROVIDER_MISS = /No data found|symbol may be delisted|"code":"Not Found"|No history for /i;

export class ProviderMissError extends Error {
  readonly [PROVIDER_MISS_BRAND] = true;

  constructor(message = "Provider could not satisfy request") {
    super(message);
    this.name = "ProviderMissError";
  }
}

export function createProviderMiss(message?: string): ProviderMissError {
  return new ProviderMissError(message);
}

function isProviderMiss(error: unknown): error is ProviderMissError {
  return error instanceof ProviderMissError
    || (!!error && typeof error === "object" && PROVIDER_MISS_BRAND in error);
}

export function shouldLogProviderError(error: unknown): boolean {
  if (isProviderMiss(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !EXPECTED_PROVIDER_MISS.test(message);
}
