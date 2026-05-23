import type { DataTableColumn } from "../../../components";
import type { OptionContract } from "../../../types/financials";

export type OptionColumnId =
  | "callLast"
  | "callBid"
  | "callAsk"
  | "callVolume"
  | "callOpenInterest"
  | "callIv"
  | "strike"
  | "putLast"
  | "putBid"
  | "putAsk"
  | "putVolume"
  | "putOpenInterest"
  | "putIv";

export type OptionColumn = DataTableColumn & { id: OptionColumnId };

export interface OptionTableRow {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
  isPositionStrike: boolean;
}

export type OptionsViewProps = {
  width: number;
  height: number;
  focused: boolean;
  onCapture?: (capturing: boolean) => void;
};
