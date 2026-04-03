import type { BrokerConfigField } from "../../types/broker";
import type { IbkrGatewayConfig } from "./gateway-service";

export const IBKR_STATEMENT_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";

export type IbkrConnectionMode = "flex" | "gateway";

export interface FlexQueryConfig {
  token: string;
  queryId: string;
  endpoint?: string;
}

export interface IbkrConfig {
  connectionMode: IbkrConnectionMode;
  flex: FlexQueryConfig;
  gateway: IbkrGatewayConfig;
}

const DEFAULT_FLEX_CONFIG: FlexQueryConfig = {
  token: "",
  queryId: "",
  endpoint: IBKR_STATEMENT_URL,
};

export const DEFAULT_GATEWAY_CONFIG: IbkrGatewayConfig = {
  host: "127.0.0.1",
  port: 4002,
  clientId: 1,
  marketDataType: "auto",
};

export const IBKR_CONFIG_FIELDS: BrokerConfigField[] = [
  {
    key: "connectionMode",
    label: "Connection Mode",
    type: "select",
    required: true,
    options: [
      { label: "Flex (read-only)", value: "flex", description: "Syncs via IBKR's Flex API. No software needed." },
      { label: "Gateway / TWS", value: "gateway", description: "Use IB Gateway or TWS for live data and trading." },
    ],
  },
  {
    key: "token",
    label: "Flex Token",
    type: "password",
    required: true,
    placeholder: "Your Flex Web Service token",
    dependsOn: { key: "connectionMode", value: "flex" },
  },
  {
    key: "queryId",
    label: "Query ID",
    type: "text",
    required: true,
    placeholder: "Numeric Flex Query ID",
    dependsOn: { key: "connectionMode", value: "flex" },
  },
  {
    key: "endpoint",
    label: "Endpoint",
    type: "text",
    required: false,
    placeholder: IBKR_STATEMENT_URL,
    dependsOn: { key: "connectionMode", value: "flex" },
  },
  {
    key: "host",
    label: "Gateway Host",
    type: "text",
    required: true,
    placeholder: DEFAULT_GATEWAY_CONFIG.host,
    defaultValue: DEFAULT_GATEWAY_CONFIG.host,
    dependsOn: { key: "connectionMode", value: "gateway" },
  },
  {
    key: "port",
    label: "Gateway Port",
    type: "number",
    required: true,
    placeholder: String(DEFAULT_GATEWAY_CONFIG.port),
    defaultValue: String(DEFAULT_GATEWAY_CONFIG.port),
    dependsOn: { key: "connectionMode", value: "gateway" },
  },
  {
    key: "clientId",
    label: "Client ID",
    type: "number",
    required: true,
    placeholder: String(DEFAULT_GATEWAY_CONFIG.clientId),
    defaultValue: String(DEFAULT_GATEWAY_CONFIG.clientId),
    dependsOn: { key: "connectionMode", value: "gateway" },
  },
];

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getMode(value: unknown): IbkrConnectionMode {
  return value === "gateway" ? "gateway" : "flex";
}

export function normalizeIbkrConfig(raw?: Record<string, unknown>): IbkrConfig {
  const input = raw ?? {};
  const nestedFlex = typeof input.flex === "object" && input.flex ? input.flex as Record<string, unknown> : {};
  const nestedGateway = typeof input.gateway === "object" && input.gateway ? input.gateway as Record<string, unknown> : {};
  const inferredMode = input.connectionMode
    ?? (input.host || input.port || input.clientId || nestedGateway.host || nestedGateway.port || nestedGateway.clientId
      ? "gateway"
      : "flex");
  const connectionMode = getMode(inferredMode);

  return {
    connectionMode,
    flex: {
      token: coerceString(nestedFlex.token ?? input.token),
      queryId: coerceString(nestedFlex.queryId ?? input.queryId),
      endpoint: coerceString(nestedFlex.endpoint ?? input.endpoint, DEFAULT_FLEX_CONFIG.endpoint),
    },
    gateway: {
      host: coerceString(nestedGateway.host ?? input.host, DEFAULT_GATEWAY_CONFIG.host),
      port: coerceNumber(nestedGateway.port ?? input.port, DEFAULT_GATEWAY_CONFIG.port),
      clientId: coerceNumber(nestedGateway.clientId ?? input.clientId, DEFAULT_GATEWAY_CONFIG.clientId),
      marketDataType: coerceString(
        nestedGateway.marketDataType ?? input.marketDataType,
        DEFAULT_GATEWAY_CONFIG.marketDataType,
      ) as IbkrGatewayConfig["marketDataType"],
    },
  };
}

export function buildIbkrConfigFromValues(values: Record<string, unknown>): IbkrConfig {
  const normalized = normalizeIbkrConfig(values);
  return {
    connectionMode: normalized.connectionMode,
    flex: normalized.flex,
    gateway: normalized.gateway,
  };
}

export function getGatewayConfig(raw?: Record<string, unknown>): IbkrGatewayConfig {
  return normalizeIbkrConfig(raw).gateway;
}

export function getFlexConfig(raw?: Record<string, unknown>): FlexQueryConfig {
  return normalizeIbkrConfig(raw).flex;
}

export function isGatewayConfigured(raw?: Record<string, unknown>): boolean {
  const config = normalizeIbkrConfig(raw);
  return config.connectionMode === "gateway"
    && !!config.gateway.host
    && Number.isFinite(config.gateway.port)
    && Number.isFinite(config.gateway.clientId);
}

export function isFlexConfigured(raw?: Record<string, unknown>): boolean {
  const config = normalizeIbkrConfig(raw);
  return config.connectionMode === "flex"
    && !!config.flex.token
    && !!config.flex.queryId;
}
