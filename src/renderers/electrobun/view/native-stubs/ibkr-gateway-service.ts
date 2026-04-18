import type { TimeRange } from "../../../../components/chart/chart-types";
import type { ChartResolutionSupport, ManualChartResolution } from "../../../../components/chart/chart-resolution";
import { backendRequest, onIbkrQuoteSubscription, onIbkrResolved, onIbkrSnapshotSubscription } from "../backend-rpc";
import type { BrokerConnectionStatus, BrokerPosition } from "../../../../types/broker";
import type { QuoteSubscriptionTarget } from "../../../../types/data-provider";
import type { Quote, PricePoint, TickerFinancials } from "../../../../types/financials";
import type { BrokerContractRef, InstrumentSearchResult } from "../../../../types/instrument";
import type { BrokerAccount, BrokerExecution, BrokerOrder, BrokerOrderPreview, BrokerOrderRequest } from "../../../../types/trading";

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

type Listener = () => void;
type ResolvedGatewayListener = (
  instanceId: string | undefined,
  connection: ResolvedIbkrGatewayConnection,
) => void | Promise<void>;

const DISCONNECTED_SNAPSHOT: IbkrSnapshot = {
  status: { state: "disconnected", updatedAt: Date.now() },
  accounts: [],
  openOrders: [],
  executions: [],
};

let resolvedGatewayListener: ResolvedGatewayListener | null = null;
let nextSnapshotSubscriptionId = 1;
let nextQuoteSubscriptionId = 1;

export function setResolvedIbkrGatewayListener(listener: ResolvedGatewayListener | null): void {
  resolvedGatewayListener = listener;
}

class ElectrobunIbkrGatewayService {
  constructor(
    private readonly manager: ElectrobunIbkrGatewayManager,
    private readonly instanceId: string,
  ) {}

  getSnapshot(): IbkrSnapshot {
    return this.manager.getSnapshot(this.instanceId);
  }

  getResolvedConnection(): ResolvedIbkrGatewayConnection | null {
    return this.manager.getResolvedConnection(this.instanceId);
  }

  async connect(config: IbkrGatewayConfig): Promise<void> {
    await backendRequest("ibkr.connect", { instanceId: this.instanceId, config });
  }

  async disconnect(): Promise<void> {
    await backendRequest("ibkr.disconnect", { instanceId: this.instanceId });
  }

  async getAccounts(config: IbkrGatewayConfig): Promise<BrokerAccount[]> {
    return backendRequest("ibkr.getAccounts", { instanceId: this.instanceId, config });
  }

  async getPositions(config: IbkrGatewayConfig): Promise<BrokerPosition[]> {
    return backendRequest("ibkr.getPositions", { instanceId: this.instanceId, config });
  }

  async listOpenOrders(config: IbkrGatewayConfig): Promise<BrokerOrder[]> {
    return backendRequest("ibkr.listOpenOrders", { instanceId: this.instanceId, config });
  }

  async listExecutions(config: IbkrGatewayConfig): Promise<BrokerExecution[]> {
    return backendRequest("ibkr.listExecutions", { instanceId: this.instanceId, config });
  }

  async searchInstruments(query: string, config: IbkrGatewayConfig): Promise<InstrumentSearchResult[]> {
    return backendRequest("ibkr.searchInstruments", { instanceId: this.instanceId, query, config });
  }

  async getTickerFinancials(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange = "",
    instrument?: BrokerContractRef | null,
  ): Promise<TickerFinancials> {
    return backendRequest("ibkr.getTickerFinancials", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      config,
      instrument,
    });
  }

  async getQuote(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange = "",
    instrument?: BrokerContractRef | null,
  ): Promise<Quote> {
    return backendRequest("ibkr.getQuote", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      config,
      instrument,
    });
  }

  async getPriceHistory(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange: string,
    range: TimeRange,
    instrument?: BrokerContractRef | null,
  ): Promise<PricePoint[]> {
    return backendRequest("ibkr.getPriceHistory", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      range,
      config,
      instrument,
    });
  }

  getChartResolutionSupport(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange = "",
    instrument?: BrokerContractRef | null,
  ): Promise<ChartResolutionSupport> {
    return backendRequest("ibkr.getChartResolutionSupport", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      config,
      instrument,
    });
  }

  async getPriceHistoryForResolution(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange: string,
    bufferRange: TimeRange,
    resolution: ManualChartResolution,
    instrument?: BrokerContractRef | null,
  ): Promise<PricePoint[]> {
    return backendRequest("ibkr.getPriceHistoryForResolution", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      bufferRange,
      resolution,
      config,
      instrument,
    });
  }

  async getDetailedPriceHistory(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    instrument?: BrokerContractRef | null,
  ): Promise<PricePoint[]> {
    return backendRequest("ibkr.getDetailedPriceHistory", {
      instanceId: this.instanceId,
      ticker,
      exchange,
      startDate,
      endDate,
      barSize,
      config,
      instrument,
    });
  }

  subscribeQuotes(
    config: IbkrGatewayConfig,
    targets: QuoteSubscriptionTarget[],
    onQuote: (target: QuoteSubscriptionTarget, quote: Quote) => void,
  ): () => void {
    const subscriptionId = `ibkr-quote:${this.instanceId}:${nextQuoteSubscriptionId++}`;
    const disposeMessages = onIbkrQuoteSubscription(subscriptionId, (message) => {
      onQuote(message.target as QuoteSubscriptionTarget, message.quote as Quote);
    });
    let disposed = false;

    void backendRequest("ibkr.subscribeQuotes", {
      instanceId: this.instanceId,
      subscriptionId,
      config,
      targets,
    }).catch((error) => {
      disposeMessages();
      console.error("Failed to subscribe to IBKR quotes", error);
    });

    return () => {
      if (disposed) return;
      disposed = true;
      disposeMessages();
      void backendRequest("ibkr.unsubscribeQuotes", {
        instanceId: this.instanceId,
        subscriptionId,
      }).catch(() => {});
    };
  }

  async previewOrder(config: IbkrGatewayConfig, request: BrokerOrderRequest): Promise<BrokerOrderPreview> {
    return backendRequest("ibkr.previewOrder", { instanceId: this.instanceId, config, request });
  }

  async placeOrder(config: IbkrGatewayConfig, request: BrokerOrderRequest): Promise<BrokerOrder> {
    return backendRequest("ibkr.placeOrder", { instanceId: this.instanceId, config, request });
  }

  async modifyOrder(config: IbkrGatewayConfig, orderId: number, request: BrokerOrderRequest): Promise<BrokerOrder> {
    return backendRequest("ibkr.modifyOrder", { instanceId: this.instanceId, config, orderId, request });
  }

  async cancelOrder(config: IbkrGatewayConfig, orderId: number): Promise<void> {
    await backendRequest("ibkr.cancelOrder", { instanceId: this.instanceId, config, orderId });
  }
}

class ElectrobunIbkrGatewayManager {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly services = new Map<string, ElectrobunIbkrGatewayService>();
  private readonly snapshots = new Map<string, IbkrSnapshot>();
  private readonly resolvedConnections = new Map<string, ResolvedIbkrGatewayConnection | null>();
  private readonly snapshotSubscriptions = new Map<string, { subscriptionId: string; disposeMessages: () => void }>();

  constructor() {
    onIbkrResolved((message) => {
      if (!message.instanceId) return;
      const connection = message.connection as ResolvedIbkrGatewayConnection;
      this.resolvedConnections.set(message.instanceId, connection);
      void resolvedGatewayListener?.(message.instanceId, connection);
      this.notify(message.instanceId);
    });
  }

  private ensureSnapshotSubscription(instanceId: string): void {
    if (this.snapshotSubscriptions.has(instanceId)) return;

    const subscriptionId = `ibkr-snapshot:${instanceId}:${nextSnapshotSubscriptionId++}`;
    const disposeMessages = onIbkrSnapshotSubscription(subscriptionId, (message) => {
      this.snapshots.set(instanceId, message.snapshot as IbkrSnapshot);
      this.resolvedConnections.set(
        instanceId,
        (message.resolvedConnection as ResolvedIbkrGatewayConnection | undefined) ?? this.resolvedConnections.get(instanceId) ?? null,
      );
      this.notify(instanceId);
    });

    this.snapshotSubscriptions.set(instanceId, { subscriptionId, disposeMessages });
    void backendRequest("ibkr.subscribeSnapshot", { instanceId, subscriptionId }).catch((error) => {
      disposeMessages();
      this.snapshotSubscriptions.delete(instanceId);
      console.error("Failed to subscribe to IBKR snapshots", error);
    });
  }

  private notify(instanceId: string): void {
    for (const listener of this.listeners.get(instanceId) ?? []) {
      listener();
    }
  }

  subscribe(instanceId: string | undefined, listener: Listener): () => void {
    if (!instanceId) return () => {};
    if (!this.listeners.has(instanceId)) {
      this.listeners.set(instanceId, new Set());
    }
    this.listeners.get(instanceId)!.add(listener);
    this.ensureSnapshotSubscription(instanceId);
    return () => {
      const bucket = this.listeners.get(instanceId);
      if (!bucket) return;
      bucket.delete(listener);
      if (bucket.size > 0) return;
      this.listeners.delete(instanceId);

      const subscription = this.snapshotSubscriptions.get(instanceId);
      if (!subscription) return;
      this.snapshotSubscriptions.delete(instanceId);
      subscription.disposeMessages();
      void backendRequest("ibkr.unsubscribeSnapshot", {
        instanceId,
        subscriptionId: subscription.subscriptionId,
      }).catch(() => {});
    };
  }

  getSnapshot(instanceId?: string): IbkrSnapshot {
    if (!instanceId) return DISCONNECTED_SNAPSHOT;
    return this.snapshots.get(instanceId) ?? DISCONNECTED_SNAPSHOT;
  }

  getResolvedConnection(instanceId?: string): ResolvedIbkrGatewayConnection | null {
    if (!instanceId) return null;
    return this.resolvedConnections.get(instanceId) ?? null;
  }

  getService(instanceId: string): ElectrobunIbkrGatewayService {
    if (!this.services.has(instanceId)) {
      this.services.set(instanceId, new ElectrobunIbkrGatewayService(this, instanceId));
    }
    return this.services.get(instanceId)!;
  }

  async removeInstance(instanceId: string): Promise<void> {
    await backendRequest("ibkr.removeInstance", { instanceId });
    this.disposeSnapshotSubscription(instanceId);
    this.services.delete(instanceId);
    this.snapshots.delete(instanceId);
    this.resolvedConnections.delete(instanceId);
    this.notify(instanceId);
  }

  async destroyAll(): Promise<void> {
    await backendRequest("ibkr.destroyAll");
    for (const instanceId of this.snapshotSubscriptions.keys()) {
      this.disposeSnapshotSubscription(instanceId);
    }
    this.services.clear();
    this.snapshots.clear();
    this.resolvedConnections.clear();
    for (const instanceId of this.listeners.keys()) {
      this.notify(instanceId);
    }
  }

  private disposeSnapshotSubscription(instanceId: string): void {
    const subscription = this.snapshotSubscriptions.get(instanceId);
    if (!subscription) return;
    this.snapshotSubscriptions.delete(instanceId);
    subscription.disposeMessages();
    void backendRequest("ibkr.unsubscribeSnapshot", {
      instanceId,
      subscriptionId: subscription.subscriptionId,
    }).catch(() => {});
  }
}

export const ibkrGatewayManager = new ElectrobunIbkrGatewayManager();
