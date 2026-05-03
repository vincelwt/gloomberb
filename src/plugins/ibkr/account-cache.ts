import type { BrokerInstanceConfig } from "../../types/config";
import type { CachePolicy } from "../../types/persistence";
import { normalizeIbkrConfig } from "./config";

const FLEX_ACCOUNT_CACHE_POLICY = {
  staleMs: 6 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const satisfies CachePolicy;

const GATEWAY_ACCOUNT_CACHE_POLICY = {
  staleMs: 30 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const satisfies CachePolicy;

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function getIbkrAccountCacheSourceKey(instance: BrokerInstanceConfig): string {
  return hashString(JSON.stringify(normalizeIbkrConfig(instance.config)));
}

export function getIbkrAccountCachePolicy(instance: BrokerInstanceConfig): CachePolicy {
  return normalizeIbkrConfig(instance.config).connectionMode === "gateway"
    ? GATEWAY_ACCOUNT_CACHE_POLICY
    : FLEX_ACCOUNT_CACHE_POLICY;
}
