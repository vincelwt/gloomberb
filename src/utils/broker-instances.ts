import type { BrokerInstanceConfig } from "../types/config";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createBrokerInstanceId(
  brokerType: string,
  label: string,
  existingIds: Iterable<string>,
): string {
  const base = `${brokerType}-${slugify(label) || "account"}`;
  const seen = new Set(existingIds);
  if (!seen.has(base)) return base;

  let suffix = 2;
  while (seen.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function buildBrokerPortfolioId(brokerInstanceId: string, accountId?: string): string {
  return `broker:${brokerInstanceId}:${accountId?.trim() || "default"}`;
}

export function isBrokerPortfolioId(collectionId: string | undefined | null): collectionId is string {
  return typeof collectionId === "string" && collectionId.startsWith("broker:");
}

export function getBrokerInstance(
  brokerInstances: BrokerInstanceConfig[],
  instanceId: string | undefined,
): BrokerInstanceConfig | undefined {
  if (!instanceId) return undefined;
  return brokerInstances.find((instance) => instance.id === instanceId);
}

export function getBrokerInstancesByType(
  brokerInstances: BrokerInstanceConfig[],
  brokerType: string,
): BrokerInstanceConfig[] {
  return brokerInstances.filter((instance) => instance.brokerType === brokerType);
}
