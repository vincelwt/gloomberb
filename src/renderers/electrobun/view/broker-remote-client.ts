import {
  setBrokerRemoteClient,
  type BrokerRemoteClient,
} from "../../../brokers/remote-broker-adapter";
import {
  BROKER_CAPABILITY_ID,
  type BrokerQuoteEvent,
  type BrokerRemoteEvent,
  type BrokerStatusEvent,
} from "../../../capabilities";
import type { BrokerConnectionStatus } from "../../../types/broker";
import { backendRequest, onCapabilityEvent } from "./backend-rpc";

const statuses = new Map<string, BrokerConnectionStatus>();
let nextSubscriptionId = 1;

function isBrokerStatusEvent(event: BrokerRemoteEvent): event is BrokerStatusEvent {
  return event.kind === "status";
}

function isBrokerQuoteEvent(event: BrokerRemoteEvent): event is BrokerQuoteEvent {
  return event.kind === "quote";
}

function invokeBrokerCapability<T>(operationId: string, payload: unknown): Promise<T> {
  return backendRequest<T>("capability.invoke", {
    capabilityId: BROKER_CAPABILITY_ID,
    operationId,
    payload,
  });
}

function subscribeBrokerCapability(
  subscriptionId: string,
  operationId: string,
  payload: unknown,
): Promise<void> {
  return backendRequest("capability.subscribe", {
    subscriptionId,
    capabilityId: BROKER_CAPABILITY_ID,
    operationId,
    payload,
  });
}

const client: BrokerRemoteClient = {
  invoke(operationInstanceId, operation, args = []) {
    return invokeBrokerCapability("invoke", {
      instanceId: operationInstanceId,
      operation,
      args,
    });
  },

  getStatus(instanceId) {
    return statuses.get(instanceId) ?? null;
  },

  subscribeStatus(instanceId, listener) {
    const subscriptionId = `broker-status:${instanceId}:${nextSubscriptionId++}`;
    const disposeEvents = onCapabilityEvent(subscriptionId, (message) => {
      const event = message.event as BrokerRemoteEvent;
      if (!isBrokerStatusEvent(event)) return;
      statuses.set(event.instanceId, event.status);
      listener();
    });
    void subscribeBrokerCapability(subscriptionId, "status", { instanceId }).catch((error) => {
      disposeEvents();
      console.error("Failed to subscribe to broker status", error);
    });
    return () => {
      disposeEvents();
      void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
    };
  },

  subscribeQuotes(instanceId, targets, onQuote) {
    const subscriptionId = `broker-quotes:${instanceId}:${nextSubscriptionId++}`;
    const disposeEvents = onCapabilityEvent(subscriptionId, (message) => {
      const event = message.event as BrokerRemoteEvent;
      if (!isBrokerQuoteEvent(event)) return;
      onQuote(event.target, event.quote);
    });
    void subscribeBrokerCapability(subscriptionId, "quotes", { instanceId, targets }).catch((error) => {
      disposeEvents();
      console.error("Failed to subscribe to broker quotes", error);
    });
    return () => {
      disposeEvents();
      void backendRequest("capability.unsubscribe", { subscriptionId }).catch(() => {});
    };
  },

  async removeInstance(instanceId) {
    await invokeBrokerCapability("removeInstance", { instanceId });
    statuses.delete(instanceId);
  },

  async destroyAll() {
    await invokeBrokerCapability("destroyAll", {});
    statuses.clear();
  },
};

export function installElectrobunBrokerRemoteClient(): void {
  setBrokerRemoteClient(client);
}
