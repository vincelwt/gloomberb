export interface BrokerPosition {
  ticker: string;
  exchange: string;
  shares: number;
  avgCost: number;
  currency: string;
  dateAcquired?: string;
  /** Optional account/portfolio identifier from the broker */
  accountId?: string;
  /** Full security name from broker */
  name?: string;
  /** Asset type: STK, ETF, OPT, FUT, BOND, etc. */
  assetCategory?: string;
  /** ISIN identifier */
  isin?: string;
  /** Current market price from broker snapshot */
  markPrice?: number;
  /** Total market value from broker */
  marketValue?: number;
  /** Unrealized P&L from broker */
  unrealizedPnl?: number;
  /** FX rate to account base currency */
  fxRateToBase?: number;
  /** Position side: "long" or "short" */
  side?: "long" | "short";
  /** Contract multiplier (e.g. 100 for options) */
  multiplier?: number;
  /** Percentage of portfolio NAV */
  percentOfNav?: number;
}

export interface BrokerConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "file" | "select";
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select type
}

export interface BrokerAdapter {
  readonly id: string;
  readonly name: string;
  validate(config: Record<string, unknown>): Promise<boolean>;
  importPositions(config: Record<string, unknown>): Promise<BrokerPosition[]>;
  configSchema: BrokerConfigField[];
}
