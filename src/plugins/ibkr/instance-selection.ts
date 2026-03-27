import type { AppConfig, BrokerInstanceConfig } from "../../types/config";
import { getBrokerInstance, getBrokerInstancesByType } from "../../utils/broker-instances";
import { isGatewayConfigured, normalizeIbkrConfig } from "./config";

export function isIbkrGatewayInstance(instance?: BrokerInstanceConfig): instance is BrokerInstanceConfig {
  if (!instance || instance.brokerType !== "ibkr" || instance.enabled === false) return false;
  const normalized = normalizeIbkrConfig(instance.config);
  return normalized.connectionMode === "gateway" && isGatewayConfigured(instance.config);
}

export function getConfiguredIbkrGatewayInstances(config: AppConfig): BrokerInstanceConfig[] {
  return getBrokerInstancesByType(config.brokerInstances, "ibkr").filter(isIbkrGatewayInstance);
}

export function getLockedIbkrTradingInstanceId(config: AppConfig, activeLeftTab: string): string | undefined {
  const activePortfolio = config.portfolios.find((portfolio) => portfolio.id === activeLeftTab);
  if (activePortfolio?.brokerId !== "ibkr" || !activePortfolio.brokerInstanceId) return undefined;
  const instance = getBrokerInstance(config.brokerInstances, activePortfolio.brokerInstanceId);
  return isIbkrGatewayInstance(instance) ? instance.id : undefined;
}

export function resolveIbkrTradingInstanceId(
  config: AppConfig,
  activeLeftTab: string,
  preferredInstanceId?: string,
): string | undefined {
  const lockedInstanceId = getLockedIbkrTradingInstanceId(config, activeLeftTab);
  if (lockedInstanceId) return lockedInstanceId;

  const preferredInstance = getBrokerInstance(config.brokerInstances, preferredInstanceId);
  if (isIbkrGatewayInstance(preferredInstance)) return preferredInstance.id;

  const gatewayInstance = getConfiguredIbkrGatewayInstances(config)[0];
  if (gatewayInstance) return gatewayInstance.id;

  return preferredInstance?.brokerType === "ibkr"
    ? preferredInstance.id
    : getBrokerInstancesByType(config.brokerInstances, "ibkr")[0]?.id;
}
