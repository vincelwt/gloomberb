import type { ResolvedOptionsTarget } from "../../utils/options";

type OptionsAvailabilityRecord = {
  available: boolean;
  checkedAt: number;
};

const optionsAvailabilityCache = new Map<string, OptionsAvailabilityRecord>();

export function setOptionsAvailability(
  targetOrKey: ResolvedOptionsTarget | string,
  available: boolean,
  checkedAt = Date.now(),
): void {
  const key = typeof targetOrKey === "string" ? targetOrKey : targetOrKey.cacheKey;
  optionsAvailabilityCache.set(key, { available, checkedAt });
}

export function resetOptionsAvailabilityCache(): void {
  optionsAvailabilityCache.clear();
}
