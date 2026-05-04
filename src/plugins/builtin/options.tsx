import { Box, Text } from "../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "../../ui";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import type { OptionContract, OptionsChain } from "../../types/financials";
import { usePaneTicker } from "../../state/app-context";
import { blendHex, colors } from "../../theme/colors";
import { formatCompact, formatNumber } from "../../utils/format";
import { formatMarketPrice } from "../../utils/market-format";
import { formatExpDate, resolveOptionsTarget } from "../../utils/options";
import { useOptionsQuery, useResolvedEntryValue } from "../../market-data/hooks";
import { DataTableView, Spinner, Tabs, usePaneFooter, type DataTableCell, type DataTableColumn, type DataTableKeyEvent } from "../../components";

type OptionColumnId =
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

type OptionColumn = DataTableColumn & { id: OptionColumnId };

interface OptionTableRow {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
  isPositionStrike: boolean;
}

const OPTION_CALL_COLOR = "#5ed69a";
const OPTION_PUT_COLOR = "#ff9c7a";
const OPTION_PRICE_COLOR = "#dfc05b";
const OPTION_ACTIVITY_COLOR = "#35a7d6";
const OPTION_IV_COLOR = "#8bd878";
const OPTION_STRIKE_COLOR = "#8fb7ff";

const OPTION_COLUMNS: OptionColumn[] = [
  { id: "callOpenInterest", label: "C OI", width: 6, align: "right", headerColor: OPTION_ACTIVITY_COLOR },
  { id: "callVolume", label: "C VOL", width: 6, align: "right", headerColor: OPTION_ACTIVITY_COLOR },
  { id: "callLast", label: "C LAST", width: 7, align: "right", headerColor: OPTION_CALL_COLOR },
  { id: "callIv", label: "C IV", width: 6, align: "right", headerColor: OPTION_IV_COLOR },
  { id: "callBid", label: "C BID", width: 7, align: "right", headerColor: OPTION_PRICE_COLOR },
  { id: "callAsk", label: "C ASK", width: 7, align: "right", headerColor: OPTION_PRICE_COLOR },
  { id: "strike", label: "STRIKE", width: 9, align: "right", headerColor: OPTION_STRIKE_COLOR },
  { id: "putBid", label: "P BID", width: 7, align: "right", headerColor: OPTION_PRICE_COLOR },
  { id: "putAsk", label: "P ASK", width: 7, align: "right", headerColor: OPTION_PRICE_COLOR },
  { id: "putIv", label: "P IV", width: 6, align: "right", headerColor: OPTION_IV_COLOR },
  { id: "putLast", label: "P LAST", width: 7, align: "right", headerColor: OPTION_PUT_COLOR },
  { id: "putVolume", label: "P VOL", width: 6, align: "right", headerColor: OPTION_ACTIVITY_COLOR },
  { id: "putOpenInterest", label: "P OI", width: 6, align: "right", headerColor: OPTION_ACTIVITY_COLOR },
];

export function OptionsTab({ width, height, focused, onCapture }: DetailTabProps) {
  const { ticker, financials } = usePaneTicker();
  const [expIdx, setExpIdx] = useState(0);
  const [strikeIdx, setStrikeIdx] = useState(0);
  const [autoScrollVersion, setAutoScrollVersion] = useState(0);
  const [scrollToIndexAlign, setScrollToIndexAlign] = useState<"nearest" | "center">("nearest");
  const [interactive, setInteractive] = useState(false);
  const userSelectedStrikeRef = useRef(false);
  const target = resolveOptionsTarget(ticker);
  const isOpt = target?.isOptionTicker ?? false;
  const parsed = target?.parsedOption ?? null;
  const effectiveTicker = target?.effectiveTicker ?? "";
  const effectiveExchange = target?.effectiveExchange ?? "";
  const instrument = target?.instrument ?? null;
  const baseRequest = target
    ? {
      instrument: {
        symbol: effectiveTicker,
        exchange: effectiveExchange,
        brokerId: instrument?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId,
        instrument,
      },
    }
    : null;
  const initialChainEntry = useOptionsQuery(baseRequest);
  const initialChain = useResolvedEntryValue(initialChainEntry);
  const selectedExpiration = initialChain?.expirationDates[expIdx];
  const expirationChainEntry = useOptionsQuery(
    baseRequest && selectedExpiration != null
      ? { ...baseRequest, expirationDate: selectedExpiration }
      : null,
  );
  const expirationChain = useResolvedEntryValue(expirationChainEntry);
  const chain = expirationChain ?? initialChain;
  const loading = (initialChainEntry?.phase === "loading" || initialChainEntry?.phase === "refreshing") && !chain
    || (expirationChainEntry?.phase === "loading" || expirationChainEntry?.phase === "refreshing");
  const error = initialChainEntry?.phase === "error"
    ? initialChainEntry.error?.message ?? "Failed to load options"
    : expirationChainEntry?.phase === "error"
      ? expirationChainEntry.error?.message ?? "Failed to load options"
      : null;

  const enterInteractive = () => {
    if (!interactive) {
      setInteractive(true);
      onCapture(true);
    }
  };

  const exitInteractive = () => {
    if (interactive) {
      setInteractive(false);
      onCapture(false);
    }
  };

  // Exit interactive mode when ticker changes
  useEffect(() => {
    userSelectedStrikeRef.current = false;
    setScrollToIndexAlign("nearest");
    exitInteractive();
    setExpIdx(0);
    setStrikeIdx(0);
  }, [effectiveTicker]);

  useEffect(() => {
    if (!parsed || !initialChain || initialChain.expirationDates.length === 0) return;
    const bestExpIdx = initialChain.expirationDates.reduce((best, ts, i) =>
      Math.abs(ts - parsed.expTs) < Math.abs(initialChain.expirationDates[best]! - parsed.expTs) ? i : best, 0);
    if (bestExpIdx !== expIdx) {
      setExpIdx(bestExpIdx);
    }
  }, [expIdx, initialChain, parsed]);

  useEffect(() => {
    userSelectedStrikeRef.current = false;
  }, [expIdx]);

  // Build sorted strike list from the union of calls and puts
  const strikes = useMemo(() => chain ? buildStrikeList(chain) : [], [chain]);
  const callsByStrike = useMemo(
    () => new Map<number, OptionContract>(chain?.calls.map((c) => [c.strike, c]) ?? []),
    [chain],
  );
  const putsByStrike = useMemo(
    () => new Map<number, OptionContract>(chain?.puts.map((p) => [p.strike, p]) ?? []),
    [chain],
  );
  const rows = useMemo<OptionTableRow[]>(() => strikes.map((strike) => ({
    strike,
    call: callsByStrike.get(strike),
    put: putsByStrike.get(strike),
    isPositionStrike: !!parsed && Math.abs(strike - parsed.strike) < 0.01,
  })), [callsByStrike, parsed, putsByStrike, strikes]);
  const selectedStrike = strikes[strikeIdx];
  const selectedCall = selectedStrike != null ? callsByStrike.get(selectedStrike) : undefined;
  const selectedPut = selectedStrike != null ? putsByStrike.get(selectedStrike) : undefined;

  usePaneFooter("options", () => {
    const info = [
      ...(selectedExpiration != null ? [{ id: "exp", parts: [{ text: formatExpDate(selectedExpiration), tone: "muted" as const }] }] : []),
      ...(selectedStrike != null ? [{ id: "strike", parts: [{ text: `Strike ${formatStrikeLabel(selectedStrike)}`, tone: "value" as const, bold: true }] }] : []),
      ...(selectedCall ? [{ id: "call-iv", parts: [{ text: "Call IV", tone: "label" as const }, { text: formatIv(selectedCall.impliedVolatility), tone: "value" as const }] }] : []),
      ...(selectedPut ? [{ id: "put-iv", parts: [{ text: "Put IV", tone: "label" as const }, { text: formatIv(selectedPut.impliedVolatility), tone: "value" as const }] }] : []),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
    ];
    return info.length > 0 ? { info } : null;
  }, [
    error,
    loading,
    selectedCall?.impliedVolatility,
    selectedExpiration,
    selectedPut?.impliedVolatility,
    selectedStrike,
  ]);

  useEffect(() => {
    setStrikeIdx((index) => {
      if (strikes.length === 0) return 0;
      return Math.min(index, strikes.length - 1);
    });
  }, [strikes.length]);

  useEffect(() => {
    if (strikes.length === 0 || userSelectedStrikeRef.current) return;
    const targetStrike = resolveDefaultStrikeTarget(parsed?.strike, financials?.quote?.price);
    if (targetStrike == null) return;
    setScrollToIndexAlign("center");
    setStrikeIdx(findNearestStrikeIndex(strikes, targetStrike));
    setAutoScrollVersion((version) => version + 1);
  }, [expIdx, financials?.quote?.price, parsed?.strike, strikes]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    const isEnter = event.name === "enter" || event.name === "return";

    if (isEnter && !interactive) {
      event.preventDefault?.();
      event.stopPropagation?.();
      enterInteractive();
      return true;
    }
    if (event.name === "escape" && interactive) {
      event.preventDefault?.();
      event.stopPropagation?.();
      exitInteractive();
      return true;
    }

    if (event.name === "j" || event.name === "down") {
      if (strikes.length === 0) return true;
      event.preventDefault?.();
      event.stopPropagation?.();
      userSelectedStrikeRef.current = true;
      setScrollToIndexAlign("nearest");
      setStrikeIdx((i) => Math.min(i + 1, strikes.length - 1));
      return true;
    }
    if (event.name === "k" || event.name === "up") {
      if (strikes.length === 0) return true;
      event.preventDefault?.();
      event.stopPropagation?.();
      userSelectedStrikeRef.current = true;
      setScrollToIndexAlign("nearest");
      setStrikeIdx((i) => Math.max(i - 1, 0));
      return true;
    }

    if (!interactive) return false;

    const numExp = chain?.expirationDates.length ?? 0;
    if (event.name === "h" || event.name === "left") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setExpIdx((i) => Math.max(i - 1, 0));
      return true;
    }
    if (event.name === "l" || event.name === "right") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setExpIdx((i) => Math.min(i + 1, Math.max(numExp - 1, 0)));
      return true;
    }
    return false;
  }, [chain?.expirationDates.length, enterInteractive, exitInteractive, interactive, strikes.length]);

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view options.</Text>;
  if (loading && !chain) return <Spinner label="Loading options chain..." />;
  if (error) return <Text fg={colors.textDim}>{error}</Text>;
  if (!chain || chain.expirationDates.length === 0) return <Text fg={colors.textDim}>No options available for {effectiveTicker}.</Text>;

  const innerWidth = Math.max(width - 4, 60);

  // Position info
  const posShares = isOpt && parsed
    ? ticker!.metadata.positions.reduce((sum, p) => sum + p.shares, 0)
    : 0;

  // Expiration selector — show a window of dates around the current selection
  const maxExpVisible = Math.max(Math.floor((innerWidth - 14) / 13), 3);
  const expStart = Math.max(0, Math.min(expIdx - Math.floor(maxExpVisible / 2), chain.expirationDates.length - maxExpVisible));
  const visibleExps = chain.expirationDates.slice(expStart, expStart + maxExpVisible);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} onMouseDown={() => { if (!interactive) enterInteractive(); }}>
      {/* Expiration selector */}
      <Box flexDirection="row" height={1} gap={1}>
        <Text fg={colors.textDim}>Exp:</Text>
        <Box flexGrow={1} height={1}>
          <Tabs
            tabs={visibleExps.map((ts, i) => ({
              label: formatExpDate(ts),
              value: String(expStart + i),
            }))}
            activeValue={String(expIdx)}
            onSelect={(value) => {
              enterInteractive();
              setExpIdx(Number(value));
            }}
            compact
            variant="bare"
          />
        </Box>
        {loading && <Spinner />}
      </Box>

      {/* Position banner */}
      {isOpt && parsed && (
        <Box height={1}>
          <Text fg={colors.textBright}>
            {`Position: ${posShares} ${parsed.side === "C" ? "call" : "put"} contract${posShares !== 1 ? "s" : ""} @ $${parsed.strike}`}
          </Text>
        </Box>
      )}

      <DataTableView<OptionTableRow, OptionColumn>
        focused={focused}
        selectedIndex={strikeIdx}
        onRootKeyDown={handleTableKeyDown}
        columns={OPTION_COLUMNS}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={() => {}}
        getItemKey={(row) => String(row.strike)}
        isSelected={(_row, index) => index === strikeIdx}
        onSelect={(_row, index) => {
          userSelectedStrikeRef.current = true;
          setScrollToIndexAlign("nearest");
          enterInteractive();
          setStrikeIdx(index);
        }}
        renderCell={renderOptionCell}
        emptyStateTitle="No strikes available."
        scrollToIndex={strikeIdx}
        scrollToIndexAlign={scrollToIndexAlign}
        scrollToIndexVersion={autoScrollVersion}
      />

    </Box>
  );
}

function buildStrikeList(chain: OptionsChain): number[] {
  const set = new Set<number>();
  for (const c of chain.calls) set.add(c.strike);
  for (const p of chain.puts) set.add(p.strike);
  return Array.from(set).sort((a, b) => a - b);
}

function resolveDefaultStrikeTarget(
  optionStrike: number | undefined,
  quotePrice: number | undefined,
): number | null {
  if (optionStrike != null && Number.isFinite(optionStrike)) return optionStrike;
  if (quotePrice != null && Number.isFinite(quotePrice)) return quotePrice;
  return null;
}

function findNearestStrikeIndex(strikes: number[], targetStrike: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < strikes.length; index += 1) {
    const distance = Math.abs(strikes[index]! - targetStrike);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function formatStrikeLabel(strike: number): string {
  const decimals = strike % 1 === 0 ? 0 : 2;
  return formatNumber(strike, decimals).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function formatIv(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function optionContractForColumn(row: OptionTableRow, columnId: OptionColumnId): OptionContract | undefined {
  return columnId.startsWith("call") ? row.call : row.put;
}

function optionColumnColor(columnId: OptionColumnId): string {
  if (columnId === "strike") return OPTION_STRIKE_COLOR;
  if (columnId.endsWith("Iv")) return OPTION_IV_COLOR;
  if (columnId.endsWith("Volume") || columnId.endsWith("OpenInterest")) return OPTION_ACTIVITY_COLOR;
  if (columnId.endsWith("Bid") || columnId.endsWith("Ask")) return OPTION_PRICE_COLOR;
  return columnId.startsWith("call") ? OPTION_CALL_COLOR : OPTION_PUT_COLOR;
}

function optionMoneynessBackground(
  row: OptionTableRow,
  contract: OptionContract | undefined,
  columnId: OptionColumnId,
  rowState: { selected: boolean; hovered: boolean },
): string | undefined {
  if (rowState.selected || rowState.hovered) return undefined;
  const inTheMoney = inferColumnMoneyness(row, contract, columnId);
  const sideColor = columnId.startsWith("call") ? colors.positive : colors.negative;
  return inTheMoney
    ? blendHex(colors.bg, sideColor, 0.13)
    : blendHex(colors.bg, colors.neutral, 0.055);
}

function inferColumnMoneyness(
  row: OptionTableRow,
  contract: OptionContract | undefined,
  columnId: OptionColumnId,
): boolean {
  if (contract) return contract.inTheMoney;
  const oppositeContract = columnId.startsWith("call") ? row.put : row.call;
  return oppositeContract ? !oppositeContract.inTheMoney : false;
}

function formatOptionContractCell(contract: OptionContract | undefined, column: OptionColumn): string {
  if (!contract) return "—";
  switch (column.id) {
    case "callLast":
    case "putLast":
      return formatMarketPrice(contract.lastPrice, { assetCategory: "OPT", maxWidth: column.width });
    case "callBid":
    case "putBid":
      return formatMarketPrice(contract.bid, { assetCategory: "OPT", maxWidth: column.width });
    case "callAsk":
    case "putAsk":
      return formatMarketPrice(contract.ask, { assetCategory: "OPT", maxWidth: column.width });
    case "callVolume":
    case "putVolume":
      return formatCompact(contract.volume);
    case "callOpenInterest":
    case "putOpenInterest":
      return formatCompact(contract.openInterest);
    case "callIv":
    case "putIv":
      return formatIv(contract.impliedVolatility);
    case "strike":
      return formatStrikeLabel(contract.strike);
  }
}

function renderOptionCell(
  row: OptionTableRow,
  column: OptionColumn,
  _index: number,
  rowState: { selected: boolean; hovered: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;

  if (column.id === "strike") {
    return {
      text: formatStrikeLabel(row.strike),
      color: selectedColor ?? OPTION_STRIKE_COLOR,
      backgroundColor: rowState.selected || rowState.hovered
        ? undefined
        : blendHex(colors.bg, row.isPositionStrike ? colors.borderFocused : colors.header, row.isPositionStrike ? 0.18 : 0.1),
      attributes: rowState.selected || row.isPositionStrike ? TextAttributes.BOLD : TextAttributes.NONE,
    };
  }

  const contract = optionContractForColumn(row, column.id);
  return {
    text: formatOptionContractCell(contract, column),
    color: selectedColor ?? (contract ? optionColumnColor(column.id) : colors.textDim),
    backgroundColor: optionMoneynessBackground(row, contract, column.id, rowState),
  };
}

export const optionsPlugin: GloomPlugin = {
  id: "options",
  name: "Options",
  version: "1.0.0",
  description: "View options chain for tickers",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "options",
      name: "Options",
      order: 35, // after Chart (30), before News (40)
      component: OptionsTab,
      isVisible: ({ hasOptionsChain }) => hasOptionsChain,
    });
  },
};
