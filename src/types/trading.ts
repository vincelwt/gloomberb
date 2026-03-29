import type { BrokerContractRef } from "./instrument";

export type BrokerOrderAction = "BUY" | "SELL";
export type BrokerOrderType = "MKT" | "LMT" | "STP" | "STP LMT";

export interface BrokerCashBalance {
  currency: string;
  quantity: number;
  baseValue?: number;
  baseCurrency?: string;
}

export interface BrokerAccount {
  accountId: string;
  name: string;
  currency?: string;
  source?: "gateway" | "flex";
  updatedAt?: number;
  netLiquidation?: number;
  totalCashValue?: number;
  settledCash?: number;
  buyingPower?: number;
  availableFunds?: number;
  excessLiquidity?: number;
  initMarginReq?: number;
  maintMarginReq?: number;
  cashBalances?: BrokerCashBalance[];
}

export interface BrokerOrderRequest {
  brokerInstanceId?: string;
  accountId?: string;
  contract: BrokerContractRef;
  action: BrokerOrderAction;
  orderType: BrokerOrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  tif?: string;
  outsideRth?: boolean;
}

export interface BrokerOrderPreview {
  initMarginBefore?: number;
  initMarginAfter?: number;
  maintMarginBefore?: number;
  maintMarginAfter?: number;
  equityWithLoanBefore?: number;
  equityWithLoanAfter?: number;
  commission?: number;
  commissionCurrency?: string;
  warningText?: string;
}

export interface BrokerOrder {
  orderId: number;
  brokerInstanceId?: string;
  accountId?: string;
  status: string;
  action: BrokerOrderAction;
  orderType: string;
  quantity: number;
  filled: number;
  remaining: number;
  avgFillPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
  tif?: string;
  warningText?: string;
  updatedAt: number;
  contract: BrokerContractRef;
}

export interface BrokerExecution {
  execId: string;
  brokerInstanceId?: string;
  orderId?: number;
  accountId?: string;
  side: string;
  shares: number;
  price: number;
  time: number;
  exchange?: string;
  contract: BrokerContractRef;
}
