export type AlertCondition = "above" | "below" | "crosses";
export type AlertStatus = "active" | "triggered" | "expired";

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  createdAt: number;
  status: AlertStatus;
  triggeredAt?: number;
  lastCheckedPrice?: number;
  message?: string;
}
