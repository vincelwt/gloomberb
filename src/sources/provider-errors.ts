const PROVIDER_MISS_BRAND = Symbol("provider-miss");

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

export function isProviderMiss(error: unknown): error is ProviderMissError {
  return error instanceof ProviderMissError
    || (!!error && typeof error === "object" && PROVIDER_MISS_BRAND in error);
}
