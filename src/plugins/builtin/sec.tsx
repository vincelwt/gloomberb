import { useEffect, useRef, useState } from "react";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import type { SecFilingItem } from "../../types/data-provider";
import { useResolvedEntryValue, useSecFilingContent, useSecFilingsQuery } from "../../market-data/hooks";
import { instrumentFromTicker } from "../../market-data/request-types";
import { usePluginPaneState } from "../../plugins/plugin-runtime";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { Spinner } from "../../components/spinner";
import { DetailFeedView, type DetailFeedItem } from "../../components/detail-feed-view";
import { isUsEquityTicker } from "../../utils/sec";
import { getSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { parseForm4Xml, transactionTypeLabel } from "./insider/insider-data";
import { formatCompact, formatCurrency } from "../../utils/format";

const SEC_FILING_LIMIT = 50;
const OWNERSHIP_FORMS = new Set(["3", "4", "5"]);

function getDisplayFormLabel(form: string): string {
  const trimmed = form.trim();
  return /^\d+(?:\/[A-Z])?$/i.test(trimmed)
    ? `FORM ${trimmed}`
    : trimmed;
}

function normalizeComparableText(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bFORM\b/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRedundantFormPrefix(form: string, description: string): string {
  const pattern = escapeRegExp(form.trim()).replace(/\s+/g, "\\s+");
  return description
    .trim()
    .replace(new RegExp(`^(?:FORM\\s+)?${pattern}(?:\\s*[:|-]\\s*|\\s+)`, "i"), "")
    .trim();
}

function getMeaningfulPrimaryDescription(filing: SecFilingItem): string | undefined {
  const description = filing.primaryDocDescription?.trim();
  if (!description) return undefined;
  if (normalizeComparableText(description) === normalizeComparableText(filing.form)) return undefined;

  const stripped = stripRedundantFormPrefix(filing.form, description);
  if (!stripped) return undefined;
  if (normalizeComparableText(stripped) === normalizeComparableText(filing.form)) return undefined;
  return stripped;
}

function getFilingDisplayTitle(filing: SecFilingItem): string {
  const description = getMeaningfulPrimaryDescription(filing);
  const formLabel = getDisplayFormLabel(filing.form);
  return description ? `${formLabel} | ${description}` : formLabel;
}

function wrapMessageLines(text: string, width: number): string[] {
  const maxWidth = Math.max(width, 12);
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current.length + 1 + word.length) <= maxWidth) {
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
  const lines = wrapMessageLines(message, width - 4);
  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      {lines.map((line, index) => (
        <box key={index} height={1}>
          <text fg={colors.textDim}>{line}</text>
        </box>
      ))}
    </box>
  );
}

function formatFiledAt(filing: SecFilingItem): string {
  return filing.filingDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildDetailBody(filing: SecFilingItem): string {
  const sections = [
    getMeaningfulPrimaryDescription(filing),
    filing.items ? `Items: ${filing.items}` : undefined,
    filing.primaryDocument ? `Primary document: ${filing.primaryDocument}` : undefined,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  return sections.length > 0
    ? sections.join("\n\n")
    : "No additional SEC filing description is available for this entry.";
}

function buildForm4Preview(content: string | null): string | null {
  if (!content) return null;
  const tx = parseForm4Xml(content);
  if (!tx) return null;
  const type = transactionTypeLabel(tx.transactionType);
  const shares = formatCompact(tx.shares);
  const price = tx.pricePerShare != null ? ` @ ${formatCurrency(tx.pricePerShare)}` : "";
  return `${tx.reportedName} — ${type} ${shares} shares${price}`;
}

function buildForm4Detail(content: string | null, filing: SecFilingItem): string {
  if (!content) return buildDetailBody(filing);
  const tx = parseForm4Xml(content);
  if (!tx) return buildDetailBody(filing);

  const lines: string[] = [];
  lines.push(`Insider: ${tx.reportedName}`);
  if (tx.title) lines.push(`Title: ${tx.title}`);
  lines.push(`Transaction: ${transactionTypeLabel(tx.transactionType)}`);
  lines.push(`Shares: ${formatCompact(tx.shares)}`);
  if (tx.pricePerShare != null) lines.push(`Price/Share: ${formatCurrency(tx.pricePerShare)}`);
  if (tx.totalValue != null) lines.push(`Total Value: ${formatCurrency(tx.totalValue)}`);
  if (tx.sharesOwned != null) lines.push(`Shares Owned After: ${formatCompact(tx.sharesOwned)}`);
  return lines.join("\n");
}

function getFormCategory(form: string): "annual" | "quarterly" | "current" | "ownership" | "other" {
  const f = form.trim().toUpperCase();
  if (f === "10-K" || f === "10-K/A" || f === "20-F") return "annual";
  if (f === "10-Q" || f === "10-Q/A") return "quarterly";
  if (f.startsWith("8-K")) return "current";
  if (OWNERSHIP_FORMS.has(f) || f === "SC 13G" || f === "SC 13D" || f === "SC 13G/A" || f === "SC 13D/A") return "ownership";
  return "other";
}

function getFormDescription(form: string): string {
  const f = form.trim().toUpperCase();
  switch (f) {
    case "10-K": return "Annual Report";
    case "10-K/A": return "Annual Report (Amended)";
    case "10-Q": return "Quarterly Report";
    case "10-Q/A": return "Quarterly Report (Amended)";
    case "8-K": return "Current Report";
    case "8-K/A": return "Current Report (Amended)";
    case "4": return "Insider Transaction";
    case "3": return "Initial Insider Ownership";
    case "5": return "Annual Insider Ownership";
    case "SC 13G": return "Beneficial Ownership (Passive)";
    case "SC 13G/A": return "Beneficial Ownership (Amended)";
    case "SC 13D": return "Beneficial Ownership (Active)";
    case "SC 13D/A": return "Beneficial Ownership (Amended)";
    case "DEF 14A": return "Proxy Statement";
    case "S-1": return "Registration Statement";
    case "20-F": return "Annual Report (Foreign)";
    default: return "";
  }
}

function toFeedItems(
  filings: SecFilingItem[],
  selectedAccessionNumber: string | undefined,
  contentCache: Map<string, string | null>,
  loadingContent: boolean,
): DetailFeedItem[] {
  return filings.map((filing) => {
    const displayTitle = getFilingDisplayTitle(filing);
    const formDesc = getFormDescription(filing.form);
    const hasFetchedContent = contentCache.has(filing.accessionNumber);
    const fetchedContent = contentCache.get(filing.accessionNumber);
    const isOwnership = OWNERSHIP_FORMS.has(filing.form.trim());
    const fallbackBody = hasFetchedContent && !loadingContent && !fetchedContent
      ? `${buildDetailBody(filing)}\n\nReadable filing content was not available for this document.`
      : buildDetailBody(filing);

    // For Form 4s, build structured preview and detail from parsed XML
    const form4Preview = isOwnership && hasFetchedContent
      ? buildForm4Preview(fetchedContent ?? null)
      : null;
    const form4Detail = isOwnership && hasFetchedContent
      ? buildForm4Detail(fetchedContent ?? null, filing)
      : null;

    const enrichedTitle = formDesc
      ? `${displayTitle} — ${formDesc}`
      : displayTitle;

    return {
      id: filing.accessionNumber,
      eyebrow: filing.form,
      title: form4Preview ? `${displayTitle} | ${form4Preview}` : enrichedTitle,
      timestamp: filing.filingDate,
      preview: form4Preview
        ?? (filing.items ? `Items ${filing.items}` : (formDesc || filing.primaryDocument)),
      detailTitle: enrichedTitle,
      detailMeta: [
        `Filed ${formatFiledAt(filing)}`,
        `Accession ${filing.accessionNumber}`,
        ...(filing.items ? [`Items ${filing.items}`] : []),
      ],
      detailBody: filing.accessionNumber === selectedAccessionNumber
        ? (
            loadingContent
              ? "Loading filing content..."
              : form4Detail ?? fetchedContent ?? fallbackBody
          )
        : form4Detail ?? fallbackBody,
      detailNote: filing.filingUrl || undefined,
    };
  });
}

function SecTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>(selectionKey, 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [contentCache, setContentCache] = useState<Map<string, string | null>>(new Map());
  const contentFetchRef = useRef(0);
  const eligibleTicker = isUsEquityTicker(ticker);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const filingsEntry = useSecFilingsQuery(
    instrument && eligibleTicker
      ? { instrument, count: SEC_FILING_LIMIT }
      : null,
  );
  const filings = useResolvedEntryValue(filingsEntry) ?? [];
  const loading = filingsEntry?.phase === "loading" || (filingsEntry?.phase === "refreshing" && filings.length === 0);
  const error = filingsEntry?.phase === "error" ? filingsEntry.error?.message ?? "Failed to load SEC filings" : null;

  useEffect(() => {
    setHoveredIdx(null);
    setContentCache(new Map());
    contentFetchRef.current += 1;
  }, [eligibleTicker, ticker?.metadata.exchange, ticker?.metadata.ticker]);

  const selected = filings[selectedIdx];
  const cachedSelectedContent = selected ? contentCache.get(selected.accessionNumber) : undefined;
  const filingContentEntry = useSecFilingContent(
    selected && cachedSelectedContent === undefined ? selected : null,
  );
  const filingContent = useResolvedEntryValue(filingContentEntry);
  const loadingContent = filingContentEntry?.phase === "loading" || filingContentEntry?.phase === "refreshing";

  useEffect(() => {
    if (!selected) return;
    if (cachedSelectedContent !== undefined) return;
    if (filingContentEntry?.phase === "error") {
      setContentCache((prev) => new Map(prev).set(selected.accessionNumber, null));
      return;
    }
    if (filingContent !== null) {
      setContentCache((prev) => new Map(prev).set(selected.accessionNumber, filingContent));
    }
  }, [cachedSelectedContent, filingContent, filingContentEntry?.phase, selected]);

  useEffect(() => {
    if (filings.length > 0 && selectedIdx >= filings.length) {
      setSelectedIdx(Math.max(0, filings.length - 1));
    }
  }, [filings.length, selectedIdx, setSelectedIdx]);

  // Background prefetch Form 4 content for enriched previews
  const prefetchStartedRef = useRef(new Set<string>());
  useEffect(() => {
    if (filings.length === 0) return;
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    const gen = contentFetchRef.current;
    const form4s = filings.filter((f) =>
      OWNERSHIP_FORMS.has(f.form.trim())
      && !contentCache.has(f.accessionNumber)
      && !prefetchStartedRef.current.has(f.accessionNumber),
    );
    if (form4s.length === 0) return;

    for (const filing of form4s) {
      prefetchStartedRef.current.add(filing.accessionNumber);
    }

    (async () => {
      for (const filing of form4s) {
        if (contentFetchRef.current !== gen) return;
        try {
          const entry = await coordinator.loadSecFilingContent(filing);
          if (contentFetchRef.current !== gen) return;
          const content = entry?.data ?? null;
          setContentCache((prev) => new Map(prev).set(filing.accessionNumber, content));
        } catch { /* skip */ }
      }
    })();
  }, [filings]);

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view SEC filings.</text>;
  if (!eligibleTicker) return renderNotice("SEC filings are only shown for US equities.", width);
  if (loading && filings.length === 0) return <Spinner label="Loading SEC filings..." />;
  if (error) return renderNotice(`Error: ${error}`, width);
  if (filings.length === 0) return renderNotice(`No recent SEC filings for ${ticker.metadata.ticker}.`, width);

  return (
    <DetailFeedView
      width={width}
      height={height}
      focused={focused}
      items={toFeedItems(filings, selected?.accessionNumber, contentCache, loadingContent)}
      selectedIdx={selectedIdx}
      hoveredIdx={hoveredIdx}
      onSelect={setSelectedIdx}
      onHover={setHoveredIdx}
      listVariant="single-line"
    />
  );
}

export const secPlugin: GloomPlugin = {
  id: "sec",
  name: "SEC",
  version: "1.0.0",
  description: "Recent SEC filings for US equities",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "sec",
      name: "SEC",
      order: 45,
      component: SecTab,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
  },
};
