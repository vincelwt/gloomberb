import type { BrokerAdapter, BrokerConnectionStatus } from "../../../types/broker";
import type { AppConfig, BrokerInstanceConfig } from "../../../types/config";
import type { BrokerAccount } from "../../../types/trading";
import { formatCurrency } from "../../../utils/format";

export type BrokerDisplayState =
  | "disabled"
  | "unavailable"
  | "configured"
  | BrokerConnectionStatus["state"];

export interface BrokerProfileRow {
  id: string;
  label: string;
  brokerType: string;
  brokerName: string;
  mode: string;
  state: BrokerDisplayState;
  stateLabel: string;
  message: string;
  updatedAt: number;
  accountCount: number;
  accountSummary: string;
  accountIds: string[];
  instance: BrokerInstanceConfig;
  adapter: BrokerAdapter | null;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatBrokerMode(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? titleCase(text) : "Configured";
}

export function formatBrokerUpdatedAt(updatedAt: number | undefined, now = Date.now()): string {
  if (!updatedAt) return "never";
  const ageMs = Math.max(0, now - updatedAt);
  if (ageMs < 60_000) return "just now";
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
}

export function summarizeBrokerAccounts(accounts: BrokerAccount[]): string {
  if (accounts.length === 0) return "0 acct";
  const currencies = new Set(accounts.map((account) => account.currency || "USD"));
  const canSum = currencies.size === 1 && accounts.every((account) => typeof account.netLiquidation === "number");
  if (!canSum) return `${accounts.length} acct${accounts.length === 1 ? "" : "s"}`;
  const currency = currencies.values().next().value ?? "USD";
  const total = accounts.reduce((sum, account) => sum + (account.netLiquidation ?? 0), 0);
  return formatCurrency(total, currency);
}

function resolveMode(
  adapter: BrokerAdapter | null,
  instance: BrokerInstanceConfig,
  status: BrokerConnectionStatus | null,
): string {
  const values = adapter?.toConfigValues?.(instance) ?? instance.config;
  return formatBrokerMode(
    status?.mode
      ?? values.connectionMode
      ?? instance.connectionMode
      ?? instance.config.connectionMode,
  );
}

function resolveState(
  instance: BrokerInstanceConfig,
  adapter: BrokerAdapter | null,
  mode: string,
  status: BrokerConnectionStatus | null,
): { state: BrokerDisplayState; label: string; message: string; updatedAt: number } {
  if (instance.enabled === false) {
    return { state: "disabled", label: "Disabled", message: "Profile is disabled", updatedAt: 0 };
  }
  if (!adapter) {
    return { state: "unavailable", label: "Unavailable", message: "Broker plugin is not available", updatedAt: 0 };
  }
  if (mode.toLowerCase() === "flex") {
    return {
      state: "configured",
      label: "Sync only",
      message: "Flex profiles sync on demand",
      updatedAt: status?.updatedAt ?? 0,
    };
  }
  if (!status) {
    return { state: "configured", label: "Configured", message: "Ready to test or sync", updatedAt: 0 };
  }

  const labels: Record<BrokerConnectionStatus["state"], string> = {
    disconnected: "Disconnected",
    connecting: "Connecting",
    connected: "Connected",
    error: "Error",
  };
  return {
    state: status.state,
    label: labels[status.state],
    message: status.message || "",
    updatedAt: status.updatedAt,
  };
}

export function buildBrokerProfileRows(
  config: AppConfig,
  adapters: ReadonlyMap<string, BrokerAdapter | null>,
  brokerAccounts: Record<string, BrokerAccount[]>,
): BrokerProfileRow[] {
  return config.brokerInstances.map((instance) => {
    const adapter = adapters.get(instance.brokerType) ?? null;
    const status = adapter?.getStatus?.(instance) ?? null;
    const mode = resolveMode(adapter, instance, status);
    const state = resolveState(instance, adapter, mode, status);
    const accounts = brokerAccounts[instance.id] ?? [];

    return {
      id: instance.id,
      label: instance.label,
      brokerType: instance.brokerType,
      brokerName: adapter?.name ?? instance.brokerType.toUpperCase(),
      mode,
      state: state.state,
      stateLabel: state.label,
      message: state.message,
      updatedAt: state.updatedAt,
      accountCount: accounts.length,
      accountSummary: summarizeBrokerAccounts(accounts),
      accountIds: accounts.map((account) => account.accountId),
      instance,
      adapter,
    };
  });
}
