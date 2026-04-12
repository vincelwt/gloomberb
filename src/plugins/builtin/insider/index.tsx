import { useEffect, useRef, useState } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, DetailTabProps } from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  useResolvedEntryValue,
  useSecFilingContent,
  useSecFilingsQuery,
} from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { usePaneTicker } from "../../../state/app-context";
import { colors } from "../../../theme/colors";
import { Spinner } from "../../../components/spinner";
import { isUsEquityTicker } from "../../../utils/sec";
import { formatCompact, formatCurrency } from "../../../utils/format";
import { parseForm4Xml, transactionTypeLabel, type InsiderTransaction } from "./insider-data";

const FORM4_LIMIT = 20;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return `${MONTH_NAMES[date.getMonth()]} ${String(date.getDate()).padStart(2, " ")} ${date.getFullYear()}`;
}

function transactionColor(type: InsiderTransaction["transactionType"]): string {
  if (type === "P") return colors.positive;
  if (type === "S") return colors.negative;
  return colors.textDim;
}

function wrapLines(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderNotice(message: string, width: number) {
  const lines = wrapLines(message, width - 4);
  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      {lines.map((line, i) => (
        <box key={i} height={1}>
          <text fg={colors.textDim}>{line}</text>
        </box>
      ))}
    </box>
  );
}

interface ParsedFiling {
  filing: SecFilingItem;
  transaction: InsiderTransaction | null;
}

function buildSummary(parsed: ParsedFiling[]): string {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  let buyShares = 0;
  let sellShares = 0;
  let buyValue = 0;
  let sellValue = 0;

  for (const { transaction } of parsed) {
    if (!transaction) continue;
    const txDate = transaction.filingDate instanceof Date ? transaction.filingDate : new Date(transaction.filingDate);
    if (isNaN(txDate.getTime()) || txDate < cutoff) continue;
    if (transaction.transactionType === "P") {
      buyShares += transaction.shares;
      buyValue += transaction.totalValue ?? 0;
    } else if (transaction.transactionType === "S") {
      sellShares += transaction.shares;
      sellValue += transaction.totalValue ?? 0;
    }
  }

  if (buyShares === 0 && sellShares === 0) return "No buy/sell activity in last 90 days.";

  const parts: string[] = [];
  if (buyShares > 0) parts.push(`Bought ${formatCompact(buyShares)} shares (${formatCurrency(buyValue)})`);
  if (sellShares > 0) parts.push(`Sold ${formatCompact(sellShares)} shares (${formatCurrency(sellValue)})`);
  return parts.join("  |  ");
}

function InsiderTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const eligibleTicker = isUsEquityTicker(ticker);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [nameFilter, setNameFilter] = useState<string | null>(null);
  const [detailFiling, setDetailFiling] = useState<ParsedFiling | null>(null);

  const filingsEntry = useSecFilingsQuery(
    instrument && eligibleTicker ? { instrument, count: FORM4_LIMIT } : null,
  );
  const allFilings = useResolvedEntryValue(filingsEntry) ?? [];
  const form4Filings = allFilings.filter((f) => f.form.trim() === "4");

  const loading =
    filingsEntry?.phase === "loading" ||
    (filingsEntry?.phase === "refreshing" && allFilings.length === 0);
  const error =
    filingsEntry?.phase === "error"
      ? (filingsEntry.error?.message ?? "Failed to load SEC filings")
      : null;

  // Fetch content for each Form 4 filing sequentially via an index pointer
  const [contentMap, setContentMap] = useState<Map<string, string | null>>(new Map());
  const fetchIndexRef = useRef(0);
  const [fetchPointer, setFetchPointer] = useState(0);

  // Reset when ticker changes
  useEffect(() => {
    fetchIndexRef.current += 1;
    setContentMap(new Map());
    setFetchPointer(0);
  }, [ticker?.metadata.ticker]);

  // Pick the next un-fetched filing to load
  const nextToFetch = form4Filings.find((f) => !contentMap.has(f.accessionNumber)) ?? null;
  const contentEntry = useSecFilingContent(nextToFetch);
  const contentValue = useResolvedEntryValue(contentEntry);

  useEffect(() => {
    if (!nextToFetch) return;
    if (contentEntry?.phase === "error") {
      setContentMap((prev) => new Map(prev).set(nextToFetch.accessionNumber, null));
      setFetchPointer((p) => p + 1);
      return;
    }
    if (contentValue !== null && contentValue !== undefined) {
      setContentMap((prev) => new Map(prev).set(nextToFetch.accessionNumber, contentValue));
      setFetchPointer((p) => p + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentValue, contentEntry?.phase, nextToFetch?.accessionNumber, fetchPointer]);

  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const allParsed: ParsedFiling[] = form4Filings.map((filing) => {
    const xml = contentMap.get(filing.accessionNumber) ?? null;
    return {
      filing,
      transaction: xml ? parseForm4Xml(xml) : null,
    };
  });

  // Apply name filter
  const parsed = nameFilter
    ? allParsed.filter((p) => p.transaction?.reportedName === nameFilter)
    : allParsed;

  // Keyboard handling
  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "escape") {
      if (detailFiling) { setDetailFiling(null); return; }
      if (nameFilter) { setNameFilter(null); setSelectedIdx(0); return; }
      return;
    }

    if (detailFiling) return; // No navigation in detail view

    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((prev) => Math.min(prev + 1, parsed.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (event.name === "return") {
      const item = parsed[selectedIdx];
      if (item?.transaction) setDetailFiling(item);
    } else if (event.name === "f") {
      // Toggle name filter on selected row's insider
      const item = parsed[selectedIdx];
      if (item?.transaction) {
        if (nameFilter === item.transaction.reportedName) {
          setNameFilter(null);
        } else {
          setNameFilter(item.transaction.reportedName);
        }
        setSelectedIdx(0);
      }
    }
  });

  // Scroll to follow selection
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb?.viewport || parsed.length === 0 || selectedIdx < 0) return;
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (selectedIdx < sb.scrollTop) sb.scrollTo(selectedIdx);
    else if (selectedIdx >= sb.scrollTop + viewportHeight) sb.scrollTo(selectedIdx - viewportHeight + 1);
  }, [selectedIdx, parsed.length]);

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view insider activity.</text>;
  if (!eligibleTicker) return renderNotice("Insider transactions are only shown for US equities.", width);
  if (loading && allFilings.length === 0) return <Spinner label="Loading insider filings..." />;
  if (error) return renderNotice(`Error: ${error}`, width);
  if (!loading && form4Filings.length === 0) {
    return renderNotice(`No Form 4 filings found for ${ticker.metadata.ticker}.`, width);
  }

  // Detail view
  if (detailFiling?.transaction) {
    const tx = detailFiling.transaction;
    const filing = detailFiling.filing;
    return (
      <box flexDirection="column" width={width} height={height}>
        <box height={1} paddingX={1}>
          <text fg={colors.textBright} attributes={TextAttributes.BOLD}>◂ {tx.reportedName}</text>
          {tx.title && <text fg={colors.textDim}> — {tx.title}</text>}
        </box>
        <scrollbox flexGrow={1} scrollY focusable={false}>
          <box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
            <box flexDirection="column">
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Transaction</text></box>
                <text fg={transactionColor(tx.transactionType)} attributes={TextAttributes.BOLD}>
                  {transactionTypeLabel(tx.transactionType)}
                </text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Date</text></box>
                <text fg={colors.text}>{formatDate(tx.filingDate)}</text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Shares</text></box>
                <text fg={colors.text}>{formatCompact(tx.shares)}</text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Price/Share</text></box>
                <text fg={colors.text}>
                  {tx.pricePerShare != null ? formatCurrency(tx.pricePerShare) : "—"}
                </text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Total Value</text></box>
                <text fg={transactionColor(tx.transactionType)}>
                  {tx.totalValue != null ? formatCurrency(tx.totalValue) : "—"}
                </text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Shares Owned</text></box>
                <text fg={colors.text}>
                  {tx.sharesOwned != null ? formatCompact(tx.sharesOwned) : "—"}
                </text>
              </box>
            </box>
            <box flexDirection="column">
              <box height={1}>
                <text fg={colors.textDim} attributes={TextAttributes.BOLD}>Filing</text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Accession</text></box>
                <text fg={colors.text}>{filing.accessionNumber}</text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Filed</text></box>
                <text fg={colors.text}>{formatDate(filing.filingDate)}</text>
              </box>
              <box flexDirection="row" height={1}>
                <box width={16}><text fg={colors.textDim}>Form</text></box>
                <text fg={colors.text}>{filing.form}</text>
              </box>
            </box>
          </box>
        </scrollbox>
      </box>
    );
  }

  const summary = buildSummary(allParsed);
  const dateW = 12;
  const typeW = 7;
  const sharesW = 10;
  const priceW = 10;
  const valueW = 12;
  const nameW = Math.max(10, width - dateW - typeW - sharesW - priceW - valueW - 2);
  const pendingCount = form4Filings.filter((f) => !contentMap.has(f.accessionNumber)).length;

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Summary bar */}
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.textDim}>{summary}</text>
        {nameFilter && (
          <box marginLeft={1}>
            <text fg={colors.warning}>[filtered: {nameFilter}]</text>
          </box>
        )}
        {pendingCount > 0 && (
          <>
            <box flexGrow={1} />
            <text fg={colors.textMuted}>loading {pendingCount}…</text>
          </>
        )}
      </box>

      {/* Column headers */}
      <box height={1} paddingX={1} flexDirection="row">
        <box width={dateW}><text fg={colors.textDim}>DATE</text></box>
        <box width={nameW}><text fg={colors.textDim}>INSIDER</text></box>
        <box width={typeW}><text fg={colors.textDim}>TYPE</text></box>
        <box width={sharesW} justifyContent="flex-end"><text fg={colors.textDim}>SHARES</text></box>
        <box width={priceW} justifyContent="flex-end"><text fg={colors.textDim}>PRICE</text></box>
        <box width={valueW} justifyContent="flex-end"><text fg={colors.textDim}>VALUE</text></box>
      </box>

      <scrollbox ref={scrollRef} flexGrow={1} scrollY focusable={false}>
        <box flexDirection="column">
          {parsed.map(({ filing, transaction }, i) => {
            const isSelected = i === selectedIdx;
            const bg = isSelected ? colors.selected : undefined;

            if (!transaction) {
              const isLoading = !contentMap.has(filing.accessionNumber);
              return (
                <box key={filing.accessionNumber} height={1} paddingX={1} flexDirection="row" backgroundColor={bg}>
                  <box width={dateW}>
                    <text fg={colors.textDim}>{formatDate(filing.filingDate)}</text>
                  </box>
                  <box flexGrow={1}>
                    <text fg={colors.textMuted}>{isLoading ? "loading…" : "—"}</text>
                  </box>
                </box>
              );
            }

            const typeLabel = transactionTypeLabel(transaction.transactionType);
            const typeFg = isSelected ? colors.selectedText : transactionColor(transaction.transactionType);
            const fg = isSelected ? colors.selectedText : colors.text;
            const dimFg = isSelected ? colors.selectedText : colors.textDim;

            return (
              <box
                key={filing.accessionNumber}
                height={1}
                paddingX={1}
                flexDirection="row"
                backgroundColor={bg}
                onMouseDown={() => setSelectedIdx(i)}
              >
                <box width={dateW}>
                  <text fg={dimFg}>{formatDate(transaction.filingDate)}</text>
                </box>
                <box
                  width={nameW}
                  onMouseDown={(ev: any) => {
                    ev.preventDefault?.();
                    if (nameFilter === transaction.reportedName) {
                      setNameFilter(null);
                    } else {
                      setNameFilter(transaction.reportedName);
                      setSelectedIdx(0);
                    }
                  }}
                >
                  <text fg={fg} attributes={TextAttributes.UNDERLINE}>
                    {transaction.reportedName.slice(0, nameW - 1)}
                  </text>
                </box>
                <box width={typeW}>
                  <text fg={typeFg} attributes={TextAttributes.BOLD}>{typeLabel}</text>
                </box>
                <box width={sharesW} justifyContent="flex-end">
                  <text fg={fg}>{formatCompact(transaction.shares)}</text>
                </box>
                <box width={priceW} justifyContent="flex-end">
                  <text fg={fg}>
                    {transaction.pricePerShare != null ? formatCurrency(transaction.pricePerShare) : "—"}
                  </text>
                </box>
                <box width={valueW} justifyContent="flex-end">
                  <text fg={typeFg}>
                    {transaction.totalValue != null ? formatCompact(transaction.totalValue) : "—"}
                  </text>
                </box>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

export const insiderPlugin: GloomPlugin = {
  id: "insider",
  name: "Insider Trading",
  version: "1.0.0",
  description: "SEC Form 4 insider transaction activity",

  setup(ctx) {
    ctx.registerDetailTab({
      id: "insider",
      name: "Insider",
      order: 47,
      component: InsiderTab,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
  },
};
