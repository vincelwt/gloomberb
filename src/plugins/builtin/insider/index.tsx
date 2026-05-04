import { Box, Text } from "../../../ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailTabProps, GloomPlugin, PaneProps } from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import {
  useResolvedEntryValue,
  useSecFilingContent,
  useSecFilingsQuery,
} from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { usePaneTicker } from "../../../state/app-context";
import { colors } from "../../../theme/colors";
import { FeedDataTableStackView, Spinner, useExternalLinkFooter, type FeedDataTableItem } from "../../../components";
import { usePluginPaneState } from "../../plugin-runtime";
import { isUsEquityTicker } from "../../../utils/sec";
import { formatCompact, formatCurrency } from "../../../utils/format";
import { parseForm4Xml, transactionTypeLabel, type InsiderTransaction } from "./insider-data";
import { createTickerSurfacePaneTemplate } from "../ticker-surface";

const FORM4_LIMIT = 20;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return `${MONTH_NAMES[date.getMonth()]} ${String(date.getDate()).padStart(2, " ")} ${date.getFullYear()}`;
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
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {lines.map((line, i) => (
        <Box key={i} height={1}>
          <Text fg={colors.textDim}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

interface ParsedFiling {
  filing: SecFilingItem;
  transaction: InsiderTransaction | null;
  isLoading: boolean;
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

function truncateText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function formatFilingForm(form: string): string {
  const value = form.trim();
  return value ? `FORM ${value}` : "FORM 4";
}

function buildTransactionTitle(transaction: InsiderTransaction): string {
  const type = transactionTypeLabel(transaction.transactionType);
  const price = transaction.pricePerShare != null
    ? ` @ ${formatCurrency(transaction.pricePerShare)}`
    : "";
  const value = transaction.totalValue != null
    ? ` | ${formatCurrency(transaction.totalValue)}`
    : "";
  return `${type} ${formatCompact(transaction.shares)} shares${price}${value}`;
}

function buildTransactionDetailBody(transaction: InsiderTransaction): string {
  const lines = [
    `Transaction: ${transactionTypeLabel(transaction.transactionType)}`,
    `Date: ${formatDate(transaction.filingDate)}`,
    `Shares: ${formatCompact(transaction.shares)}`,
    `Price/Share: ${transaction.pricePerShare != null ? formatCurrency(transaction.pricePerShare) : "—"}`,
    `Total Value: ${transaction.totalValue != null ? formatCurrency(transaction.totalValue) : "—"}`,
    `Shares Owned After: ${transaction.sharesOwned != null ? formatCompact(transaction.sharesOwned) : "—"}`,
  ];
  return lines.join("\n");
}

function toFeedItems(parsed: ParsedFiling[]): FeedDataTableItem[] {
  return parsed.map(({ filing, transaction, isLoading }) => {
    const filingMeta = [
      `Filed ${formatDate(filing.filingDate)}`,
      `Accession ${filing.accessionNumber}`,
      formatFilingForm(filing.form),
    ];

    if (!transaction) {
      return {
        id: filing.accessionNumber,
        eyebrow: formatFilingForm(filing.form),
        title: isLoading ? "Loading Form 4 filing..." : "Form 4 transaction unavailable",
        timestamp: filing.filingDate,
        detailTitle: isLoading ? "Loading Form 4 filing..." : "Form 4 transaction unavailable",
        detailMeta: filingMeta,
        detailBody: isLoading
          ? "Loading filing content..."
          : "This Form 4 filing could not be parsed into a transaction summary.",
      };
    }

    return {
      id: filing.accessionNumber,
      eyebrow: transaction.reportedName,
      title: buildTransactionTitle(transaction),
      timestamp: transaction.filingDate,
      preview: transaction.title || undefined,
      detailTitle: transaction.reportedName,
      detailMeta: [
        ...(transaction.title ? [transaction.title] : []),
        ...filingMeta,
      ],
      detailBody: buildTransactionDetailBody(transaction),
    };
  });
}

export function InsiderView({ width, height, focused }: Pick<DetailTabProps, "width" | "height" | "focused">) {
  const { ticker } = usePaneTicker();
  const tickerKey = ticker?.metadata.ticker ?? "none";
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>(`insider:selectedIdx:${tickerKey}`, 0);
  const [nameFilter, setNameFilter] = usePluginPaneState<string | null>(`insider:nameFilter:${tickerKey}`, null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const eligibleTicker = isUsEquityTicker(ticker);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);

  const filingsEntry = useSecFilingsQuery(
    instrument && eligibleTicker ? { instrument, count: FORM4_LIMIT } : null,
  );
  const allFilings = useResolvedEntryValue(filingsEntry) ?? [];
  const form4Filings = useMemo(
    () => allFilings.filter((f) => f.form.trim() === "4"),
    [allFilings],
  );

  const loading =
    filingsEntry?.phase === "loading" ||
    (filingsEntry?.phase === "refreshing" && allFilings.length === 0);
  const error =
    filingsEntry?.phase === "error"
      ? (filingsEntry.error?.message ?? "Failed to load SEC filings")
      : null;

  // Fetch content for each Form 4 filing sequentially via an index pointer
  const [contentMap, setContentMap] = useState<Map<string, string | null>>(new Map());
  const [fetchPointer, setFetchPointer] = useState(0);

  // Reset when ticker changes
  useEffect(() => {
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

  const allParsed: ParsedFiling[] = useMemo(() => form4Filings.map((filing) => {
    const hasContent = contentMap.has(filing.accessionNumber);
    const xml = contentMap.get(filing.accessionNumber) ?? null;
    return {
      filing,
      transaction: xml ? parseForm4Xml(xml) : null,
      isLoading: !hasContent,
    };
  }), [contentMap, form4Filings]);

  // Apply name filter
  const parsed = useMemo(() => (
    nameFilter
      ? allParsed.filter((p) => p.transaction?.reportedName === nameFilter)
      : allParsed
  ), [allParsed, nameFilter]);
  const feedItems = useMemo(() => toFeedItems(parsed), [parsed]);
  const summary = useMemo(() => buildSummary(allParsed), [allParsed]);
  const pendingCount = form4Filings.filter((f) => !contentMap.has(f.accessionNumber)).length;
  const selectedTransaction = parsed[selectedIdx]?.transaction ?? null;
  const openFiling = openItemId
    ? parsed.find(({ filing }) => filing.accessionNumber === openItemId)?.filing ?? null
    : null;

  const toggleNameFilter = useCallback((reportedName: string) => {
    setNameFilter((current) => current === reportedName ? null : reportedName);
    setSelectedIdx(0);
  }, [setNameFilter, setSelectedIdx]);
  const clearNameFilter = useCallback(() => {
    setNameFilter(null);
    setSelectedIdx(0);
  }, [setNameFilter, setSelectedIdx]);

  const handleRootKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (event.name !== "f") return false;
    if (!selectedTransaction) return false;
    event.stopPropagation?.();
    event.preventDefault?.();
    toggleNameFilter(selectedTransaction.reportedName);
    return true;
  }, [selectedTransaction, toggleNameFilter]);

  const selectedFilterName = selectedTransaction?.reportedName ?? null;
  const pendingLabel = pendingCount > 0 ? `loading ${pendingCount}...` : "";
  const footerInfo = useMemo(() => [
    { id: "summary", parts: [{ text: truncateText(summary, Math.max(24, width - 20)), tone: "muted" as const }] },
    ...(nameFilter ? [{ id: "filter", parts: [{ text: `filter: ${truncateText(nameFilter, 24)}`, tone: "warning" as const }] }] : []),
    ...(pendingLabel ? [{ id: "pending", parts: [{ text: pendingLabel, tone: "muted" as const }] }] : []),
  ], [nameFilter, pendingLabel, summary, width]);
  const footerHints = useMemo(() => (
    selectedFilterName || nameFilter
      ? [{
          id: "filter",
          key: "f",
          label: "ilter",
          onPress: () => {
            if (nameFilter) clearNameFilter();
            else if (selectedFilterName) toggleNameFilter(selectedFilterName);
          },
        }]
      : []
  ), [clearNameFilter, nameFilter, selectedFilterName, toggleNameFilter]);
  useExternalLinkFooter({
    registrationId: "insider",
    focused,
    url: error ? null : openFiling?.filingUrl,
    source: openFiling?.form ? formatFilingForm(openFiling.form) : null,
    info: footerInfo,
    hints: footerHints,
    label: "filing",
  });

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view insider activity.</Text>;
  if (!eligibleTicker) return renderNotice("Insider transactions are only shown for US equities.", width);
  if (loading && allFilings.length === 0) return <Spinner label="Loading insider filings..." />;
  if (error) return renderNotice(`Error: ${error}`, width);
  if (!loading && form4Filings.length === 0) {
    return renderNotice(`No Form 4 filings found for ${ticker.metadata.ticker}.`, width);
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={feedItems}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Insider"
      titleLabel="Transaction"
      emptyStateTitle={nameFilter ? "No insider transactions for this filter." : "No insider transactions."}
    />
  );
}

function InsiderTab(props: DetailTabProps) {
  return <InsiderView {...props} />;
}

function InsiderPane({ focused, width, height }: PaneProps) {
  return <InsiderView focused={focused} width={width} height={height} />;
}

export const insiderPlugin: GloomPlugin = {
  id: "insider",
  name: "Insider Trading",
  version: "1.0.0",
  description: "SEC Form 4 insider transaction activity",

  panes: [
    {
      id: "insider",
      name: "Insider",
      icon: "I",
      component: InsiderPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "insider-pane",
      paneId: "insider",
      label: "Insider",
      description: "Insider transaction activity for the selected ticker.",
      keywords: ["insider", "form 4", "ownership", "transactions", "ins"],
      shortcut: "INS",
      canCreate: (_context, options) => !options?.ticker || isUsEquityTicker(options.ticker),
    }),
  ],

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
