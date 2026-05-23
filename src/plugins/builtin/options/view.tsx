import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "../../../ui";
import { usePaneTicker } from "../../../state/app-context";
import { colors } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { formatExpDate, resolveOptionsTarget } from "../../../utils/options";
import { useOptionsQuery, useResolvedEntryValue } from "../../../market-data/hooks";
import { DataTableView, Spinner, Tabs, usePaneFooter, type DataTableKeyEvent } from "../../../components";
import {
  OPTION_COLUMNS,
  buildStrikeList,
  findNearestStrikeIndex,
  formatIv,
  formatStrikeLabel,
  optionColumnColor,
  renderOptionCell,
  resolveDefaultStrikeTarget,
} from "./table";
import type { OptionColumn, OptionTableRow, OptionsViewProps } from "./types";

export function OptionsView({ width, focused, onCapture = () => {} }: OptionsViewProps) {
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

  const strikes = useMemo(() => chain ? buildStrikeList(chain) : [], [chain]);
  const callsByStrike = useMemo(
    () => new Map(chain?.calls.map((c) => [c.strike, c]) ?? []),
    [chain],
  );
  const putsByStrike = useMemo(
    () => new Map(chain?.puts.map((p) => [p.strike, p]) ?? []),
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
  const optionColumns: OptionColumn[] = OPTION_COLUMNS.map((column) => ({
    ...column,
    headerColor: optionColumnColor(column.id, colors.panel),
  }));

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

    if (isPlainKey(event, "j", "down")) {
      if (strikes.length === 0) return true;
      event.preventDefault?.();
      event.stopPropagation?.();
      userSelectedStrikeRef.current = true;
      setScrollToIndexAlign("nearest");
      setStrikeIdx((i) => Math.min(i + 1, strikes.length - 1));
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      if (strikes.length === 0) return true;
      event.preventDefault?.();
      event.stopPropagation?.();
      userSelectedStrikeRef.current = true;
      setScrollToIndexAlign("nearest");
      setStrikeIdx((i) => Math.max(i - 1, 0));
      return true;
    }

    return false;
  }, [enterInteractive, exitInteractive, interactive, strikes.length]);

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view options.</Text>;
  if (loading && !chain) return <Spinner label="Loading options chain..." />;
  if (error) return <Text fg={colors.textDim}>{error}</Text>;
  if (!chain || chain.expirationDates.length === 0) return <Text fg={colors.textDim}>No options available for {effectiveTicker}.</Text>;

  const innerWidth = Math.max(width - 4, 60);
  const posShares = isOpt && parsed
    ? ticker.metadata.positions.reduce((sum, p) => sum + p.shares, 0)
    : 0;
  const maxExpVisible = Math.max(Math.floor((innerWidth - 14) / 13), 3);
  const expStart = Math.max(0, Math.min(expIdx - Math.floor(maxExpVisible / 2), chain.expirationDates.length - maxExpVisible));
  const visibleExps = chain.expirationDates.slice(expStart, expStart + maxExpVisible);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} onMouseDown={() => { if (!interactive) enterInteractive(); }}>
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
            focused={focused && interactive}
          />
        </Box>
        {loading && <Spinner />}
      </Box>

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
        columns={optionColumns}
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
