import { createHash } from "crypto";
import type { ResourceStore } from "../../data/resource-store";
import type { BrokerInstanceConfig } from "../../types/config";
import type { BrokerAccount } from "../../types/trading";
import { normalizeIbkrConfig, type IbkrConnectionMode } from "./config";

const IBKR_PLUGIN_NAMESPACE = "plugin:ibkr";
const IBKR_ACCOUNT_SNAPSHOT_KIND = "account-snapshot";
const IBKR_ACCOUNT_SNAPSHOT_SCHEMA_VERSION = 1;

const FLEX_ACCOUNT_CACHE_POLICY = {
  staleMs: 6 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const;

const GATEWAY_ACCOUNT_CACHE_POLICY = {
  staleMs: 30 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const;

interface PersistedIbkrAccountSnapshot {
  connectionMode: IbkrConnectionMode;
  accounts: BrokerAccount[];
}

function getIbkrAccountSnapshotSourceKey(instance: BrokerInstanceConfig): string {
  const normalized = normalizeIbkrConfig(instance.config);
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function getAccountCachePolicy(instance: BrokerInstanceConfig) {
  const normalized = normalizeIbkrConfig(instance.config);
  return normalized.connectionMode === "gateway"
    ? GATEWAY_ACCOUNT_CACHE_POLICY
    : FLEX_ACCOUNT_CACHE_POLICY;
}

function pruneMismatchedSnapshots(resources: ResourceStore, instance: BrokerInstanceConfig, sourceKey: string): void {
  const records = resources.list<PersistedIbkrAccountSnapshot>({
    namespace: IBKR_PLUGIN_NAMESPACE,
    kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
    entityKey: instance.id,
  }, {
    schemaVersion: IBKR_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    allowExpired: true,
  });

  for (const record of records) {
    if (record.sourceKey === sourceKey) continue;
    resources.delete({
      namespace: IBKR_PLUGIN_NAMESPACE,
      kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
      entityKey: instance.id,
      sourceKey: record.sourceKey,
    });
  }
}

export function loadPersistedIbkrAccounts(
  resources: ResourceStore,
  instance: BrokerInstanceConfig,
): BrokerAccount[] | null {
  const sourceKey = getIbkrAccountSnapshotSourceKey(instance);
  pruneMismatchedSnapshots(resources, instance, sourceKey);

  return resources.get<PersistedIbkrAccountSnapshot>({
    namespace: IBKR_PLUGIN_NAMESPACE,
    kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
    entityKey: instance.id,
    sourceKey,
  }, {
    schemaVersion: IBKR_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  })?.value.accounts ?? null;
}

export function persistIbkrAccounts(
  resources: ResourceStore,
  instance: BrokerInstanceConfig,
  accounts: BrokerAccount[],
): void {
  const sourceKey = getIbkrAccountSnapshotSourceKey(instance);
  pruneMismatchedSnapshots(resources, instance, sourceKey);

  resources.set<PersistedIbkrAccountSnapshot>({
    namespace: IBKR_PLUGIN_NAMESPACE,
    kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
    entityKey: instance.id,
    sourceKey,
  }, {
    connectionMode: normalizeIbkrConfig(instance.config).connectionMode,
    accounts,
  }, {
    schemaVersion: IBKR_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    cachePolicy: getAccountCachePolicy(instance),
  });
}

export function loadPersistedIbkrAccountMap(
  resources: ResourceStore,
  brokerInstances: BrokerInstanceConfig[],
): Record<string, BrokerAccount[]> {
  const accountMap: Record<string, BrokerAccount[]> = {};

  for (const instance of brokerInstances) {
    if (instance.brokerType !== "ibkr") continue;
    const accounts = loadPersistedIbkrAccounts(resources, instance);
    if (!accounts || accounts.length === 0) continue;
    accountMap[instance.id] = accounts;
  }

  return accountMap;
}

export function clearPersistedIbkrAccounts(
  resources: ResourceStore,
  instanceId: string,
): void {
  const records = resources.list<PersistedIbkrAccountSnapshot>({
    namespace: IBKR_PLUGIN_NAMESPACE,
    kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
    entityKey: instanceId,
  }, {
    schemaVersion: IBKR_ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
    allowExpired: true,
  });

  for (const record of records) {
    resources.delete({
      namespace: IBKR_PLUGIN_NAMESPACE,
      kind: IBKR_ACCOUNT_SNAPSHOT_KIND,
      entityKey: instanceId,
      sourceKey: record.sourceKey,
    });
  }
}
