import type { BrokerConnectionStatus } from "../../../../types/broker";
import type { QuoteSubscriptionTarget } from "../../../../types/data-provider";
import type { Quote } from "../../../../types/financials";
import type { BrokerAccount, BrokerExecution, BrokerOrder } from "../../../../types/trading";

export interface IbkrGatewayConfig {
  host: string;
  port?: number;
  clientId?: number;
  lastSuccessfulPort?: number;
  lastSuccessfulClientId?: number;
  marketDataType?: "auto" | "live" | "frozen" | "delayed" | "delayed-frozen";
}

export interface ResolvedIbkrGatewayConnection {
  host: string;
  port: number;
  clientId: number;
  requestedPort?: number;
  requestedClientId: number;
}

export interface IbkrSnapshot {
  status: BrokerConnectionStatus;
  accounts: BrokerAccount[];
  openOrders: BrokerOrder[];
  executions: BrokerExecution[];
  lastError?: string;
}

const SNAPSHOT: IbkrSnapshot = {
  status: { state: "disconnected", updatedAt: Date.now(), message: "IBKR gateway runs in the native backend." },
  accounts: [],
  openOrders: [],
  executions: [],
};

type Listener = () => void;

export function setResolvedIbkrGatewayListener(): void {}

function unsupported(): never {
  throw new Error("IBKR gateway actions are not available in the Tauri web renderer yet.");
}

class TauriIbkrGatewayService {
  getSnapshot(): IbkrSnapshot {
    return SNAPSHOT;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async getAccounts(): Promise<BrokerAccount[]> { return []; }
  async listOpenOrders(): Promise<BrokerOrder[]> { return []; }
  async listExecutions(): Promise<BrokerExecution[]> { return []; }
  async searchInstruments(): Promise<[]> { return []; }
  async getTickerFinancials(): Promise<never> { unsupported(); }
  async getQuote(): Promise<never> { unsupported(); }
  async getPriceHistory(): Promise<[]> { return []; }
  getChartResolutionSupport(): [] { return []; }
  async getPriceHistoryForResolution(): Promise<[]> { return []; }
  async getDetailedPriceHistory(): Promise<[]> { return []; }
  subscribeQuotes(_config: IbkrGatewayConfig, _targets: QuoteSubscriptionTarget[], _onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void): () => void {
    return () => {};
  }
  async previewOrder(): Promise<never> { unsupported(); }
  async placeOrder(): Promise<never> { unsupported(); }
  async cancelOrder(): Promise<never> { unsupported(); }
}

class TauriIbkrGatewayManager {
  private readonly listeners = new Set<Listener>();
  private readonly services = new Map<string, TauriIbkrGatewayService>();

  subscribe(_instanceId: string | undefined, listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(_instanceId?: string): IbkrSnapshot {
    return SNAPSHOT;
  }

  getService(instanceId: string): TauriIbkrGatewayService {
    if (!this.services.has(instanceId)) {
      this.services.set(instanceId, new TauriIbkrGatewayService());
    }
    return this.services.get(instanceId)!;
  }

  async removeInstance(instanceId: string): Promise<void> {
    this.services.delete(instanceId);
    for (const listener of this.listeners) listener();
  }

  async destroyAll(): Promise<void> {
    this.services.clear();
    for (const listener of this.listeners) listener();
  }
}

export const ibkrGatewayManager = new TauriIbkrGatewayManager();
