import type { BrokerAdapter, BrokerPosition } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import {
  getGatewayConfig,
  IBKR_CONFIG_FIELDS,
  isFlexConfigured,
  isGatewayConfigured,
  normalizeIbkrConfig,
  type FlexQueryConfig,
} from "./config";
import { loadFlexStatement, parseFlexAccounts, parseFlexPositions } from "./flex";
import { ibkrGatewayManager } from "./gateway-service";
import { refreshGatewayData } from "./gateway-helpers";

async function importFlexPositions(config: FlexQueryConfig): Promise<BrokerPosition[]> {
  const xml = await loadFlexStatement(config);
  return parseFlexPositions(xml);
}

export const ibkrBroker: BrokerAdapter = {
  id: "ibkr",
  name: "Interactive Brokers",
  configSchema: IBKR_CONFIG_FIELDS,

  async validate(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    return normalized.connectionMode === "gateway"
      ? isGatewayConfigured(instance.config)
      : isFlexConfigured(instance.config);
  },

  async importPositions(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode === "gateway") {
      await refreshGatewayData(instance);
      return ibkrGatewayManager.getService(instance.id).getPositions(normalized.gateway);
    }
    return importFlexPositions(normalized.flex);
  },

  async connect(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return;
    await ibkrGatewayManager.getService(instance.id).connect(normalized.gateway);
  },

  async disconnect(instance) {
    await ibkrGatewayManager.removeInstance(instance.id);
  },

  getStatus(instance) {
    return { ...ibkrGatewayManager.getSnapshot(instance.id).status, mode: "gateway" };
  },

  async listAccounts(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode === "gateway") {
      return ibkrGatewayManager.getService(instance.id).getAccounts(normalized.gateway);
    }
    const xml = await loadFlexStatement(normalized.flex);
    return parseFlexAccounts(xml);
  },

  async searchInstruments(query, instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return (await ibkrGatewayManager.getService(instance.id).searchInstruments(query, normalized.gateway)).map((result) => ({
      ...result,
      brokerInstanceId: result.brokerInstanceId ?? instance.id,
      brokerLabel: result.brokerLabel ?? instance.label,
      brokerContract: result.brokerContract
        ? { ...result.brokerContract, brokerInstanceId: result.brokerContract.brokerInstanceId ?? instance.id }
        : undefined,
    }));
  },

  async getTickerFinancials(ticker, instance, exchange, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker market data");
    }
    return ibkrGatewayManager.getService(instance.id).getTickerFinancials(ticker, normalized.gateway, exchange, instrument);
  },

  async getQuote(ticker, instance, exchange, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker quotes");
    }
    return ibkrGatewayManager.getService(instance.id).getQuote(ticker, normalized.gateway, exchange, instrument);
  },

  async getPriceHistory(ticker, instance, exchange, range, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker history");
    }
    return ibkrGatewayManager.getService(instance.id).getPriceHistory(ticker, normalized.gateway, exchange, range, instrument);
  },

  async getDetailedPriceHistory(ticker, instance, exchange, startDate, endDate, barSize, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker history");
    }
    return ibkrGatewayManager.getService(instance.id).getDetailedPriceHistory(
      ticker,
      normalized.gateway,
      exchange,
      startDate,
      endDate,
      barSize,
      instrument,
    );
  },

  subscribeQuotes(instance, targets, onQuote) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      return () => {};
    }
    return ibkrGatewayManager.getService(instance.id).subscribeQuotes(normalized.gateway, targets, onQuote);
  },

  async listOpenOrders(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return ibkrGatewayManager.getService(instance.id).listOpenOrders(normalized.gateway);
  },

  async listExecutions(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return ibkrGatewayManager.getService(instance.id).listExecutions(normalized.gateway);
  },

  async previewOrder(instance, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for order preview");
    }
    return ibkrGatewayManager.getService(instance.id).previewOrder(normalized.gateway, request);
  },

  async placeOrder(instance, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).placeOrder(normalized.gateway, request);
  },

  async modifyOrder(instance, orderId, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).modifyOrder(normalized.gateway, orderId, request);
  },

  async cancelOrder(instance, orderId) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).cancelOrder(normalized.gateway, orderId);
  },
};
