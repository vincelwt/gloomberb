import { useSyncExternalStore } from "react";
import type { BrokerInstanceConfig } from "../../types/config";
import { getGatewayConfig } from "./config";
import { ibkrGatewayManager } from "./gateway-service";

export function useGatewaySnapshot(instanceId?: string) {
  return useSyncExternalStore(
    (listener) => ibkrGatewayManager.subscribe(instanceId, listener),
    () => ibkrGatewayManager.getSnapshot(instanceId),
  );
}

export function getGatewayRequiredMessage(instanceCount: number) {
  return instanceCount > 0
    ? "Choose a Gateway / TWS IBKR profile first."
    : "Connect a Gateway / TWS IBKR profile first.";
}

export async function refreshGatewayData(instance: BrokerInstanceConfig): Promise<void> {
  const gateway = getGatewayConfig(instance.config);
  const service = ibkrGatewayManager.getService(instance.id);
  await service.connect(gateway);
  await Promise.allSettled([
    service.getAccounts(gateway),
    service.listOpenOrders(gateway),
    service.listExecutions(gateway),
  ]);
}
