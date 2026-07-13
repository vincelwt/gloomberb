import { Text } from "../../../ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GloomPlugin } from "../../../types/plugin";
import type { SecFilingDocument, SecFilingItem } from "../../../types/data-provider";
import { useResolvedEntryValue, useSecFilingContent, useSecFilingDocuments, useSecFilingsQuery } from "../../../market-data/hooks";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useDebouncedPluginPaneState } from "../../runtime";
import { usePaneTicker } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { FeedDataTableStackView, Spinner, useExternalLinkFooter, type FeedDataTableItem } from "../../../components";
import { isUsEquityTicker } from "../../../utils/sec";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { parseForm4Xml, transactionTypeLabel } from "../insider/insider-data";
import { formatCompact, formatCurrency } from "../../../utils/format";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import {
  formatFilingMetaDate,
  renderFilingNotice,
} from "./filing-display";
import {
  documentContentKey,
  documentContentTarget,
  documentHeading,
  formatCompactDocumentLabel,
  isDefaultVisibleFilingDocument,
  isInlineExhibitDocument,
} from "./filing-documents";

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

function formatFiledAt(filing: SecFilingItem): string {
  return formatFilingMetaDate(filing.filingDate);
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

function buildDetailBodyWithDocuments({
  filing,
  documents,
  documentsLoading,
  contentCache,
  primaryContent,
}: {
  filing: SecFilingItem;
  documents: SecFilingDocument[];
  documentsLoading: boolean;
  contentCache: Map<string, string | null>;
  primaryContent: string;
}): string {
  const lines: string[] = [];
  lines.push("Documents");
  if (documentsLoading && documents.length === 0) {
    lines.push("Loading filing documents...");
  } else if (documents.length === 0) {
    lines.push("No filing documents were listed for this filing.");
  } else {
    const visibleDocuments = documents.filter(isDefaultVisibleFilingDocument);
    lines.push(...visibleDocuments.map(formatCompactDocumentLabel));
    const hiddenCount = documents.length - visibleDocuments.length;
    if (hiddenCount > 0) lines.push(`+ ${hiddenCount} support documents hidden`);
  }

  const exhibits = documents.filter(isInlineExhibitDocument);
  if (exhibits.length > 0) {
    lines.push("", "Inline Exhibits");
    for (const document of exhibits) {
      const key = documentContentKey(filing, document);
      const hasContent = contentCache.has(key);
      const content = contentCache.get(key);
      lines.push("", documentHeading(document));
      lines.push(hasContent
        ? content || "Readable document content was not available for this exhibit."
        : "Loading exhibit content...");
    }
  }

  lines.push("", "Primary Filing Content", primaryContent);
  return lines.join("\n");
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
  selectedDocuments: SecFilingDocument[],
  loadingDocuments: boolean,
): FeedDataTableItem[] {
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
    const selected = filing.accessionNumber === selectedAccessionNumber;
    const primaryDetailBody = loadingContent && selected
      ? "Loading filing content..."
      : form4Detail ?? fetchedContent ?? fallbackBody;
    const detailBody = selected
      ? buildDetailBodyWithDocuments({
          filing,
          documents: selectedDocuments,
          documentsLoading: loadingDocuments,
          contentCache,
          primaryContent: primaryDetailBody,
        })
      : form4Detail ?? fallbackBody;

    const enrichedTitle = formDesc
      ? `${displayTitle} — ${formDesc}`
      : displayTitle;

    return {
      id: filing.accessionNumber,
      eyebrow: filing.form,
      title: form4Preview ? `${displayTitle} | ${form4Preview}` : enrichedTitle,
      timestamp: filing.filingDate,
      detailTitle: enrichedTitle,
      detailMeta: [
        `Filed ${formatFiledAt(filing)}`,
        `Accession ${filing.accessionNumber}`,
        ...(filing.items ? [`Items ${filing.items}`] : []),
      ],
      detailBody,
    };
  });
}

function SecView({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { ticker } = usePaneTicker();
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>(selectionKey, 0);
  const [contentCache, setContentCache] = useState<Map<string, string | null>>(new Map());
  const [openItemId, setOpenItemId] = useState<string | null>(null);
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
    setContentCache(new Map());
    contentFetchRef.current += 1;
  }, [eligibleTicker, ticker?.metadata.exchange, ticker?.metadata.ticker]);

  const openFiling = openItemId
    ? filings.find((filing) => filing.accessionNumber === openItemId) ?? null
    : null;
  const cachedOpenContent = openFiling ? contentCache.get(openFiling.accessionNumber) : undefined;
  const filingContentEntry = useSecFilingContent(
    openFiling && cachedOpenContent === undefined ? openFiling : null,
  );
  const filingContent = useResolvedEntryValue(filingContentEntry);
  const loadingContent = filingContentEntry?.phase === "loading" || filingContentEntry?.phase === "refreshing";
  const documentsEntry = useSecFilingDocuments(openFiling ?? null);
  const openDocuments = useResolvedEntryValue(documentsEntry) ?? [];
  const loadingDocuments = !!openFiling && (
    documentsEntry?.phase === "idle"
    || documentsEntry?.phase === "loading"
    || documentsEntry?.phase === "refreshing"
  );

  useEffect(() => {
    if (!openFiling) return;
    if (cachedOpenContent !== undefined) return;
    if (filingContentEntry?.phase === "error") {
      setContentCache((prev) => new Map(prev).set(openFiling.accessionNumber, null));
      return;
    }
    if (filingContent !== null) {
      setContentCache((prev) => new Map(prev).set(openFiling.accessionNumber, filingContent));
    }
  }, [cachedOpenContent, filingContent, filingContentEntry?.phase, openFiling]);

  const documentFetchStartedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!openFiling || openDocuments.length === 0) return;
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    const gen = contentFetchRef.current;
    const documentsToFetch = openDocuments.filter((document) => {
      if (!isInlineExhibitDocument(document)) return false;
      const key = documentContentKey(openFiling, document);
      return !contentCache.has(key) && !documentFetchStartedRef.current.has(key);
    });
    if (documentsToFetch.length === 0) return;

    for (const document of documentsToFetch) {
      documentFetchStartedRef.current.add(documentContentKey(openFiling, document));
    }

    (async () => {
      for (const document of documentsToFetch) {
        if (contentFetchRef.current !== gen) return;
        const key = documentContentKey(openFiling, document);
        try {
          const entry = await coordinator.loadSecFilingContent(documentContentTarget(openFiling, document));
          if (contentFetchRef.current !== gen) return;
          setContentCache((prev) => new Map(prev).set(key, entry.data ?? entry.lastGoodData ?? null));
        } catch {
          if (contentFetchRef.current !== gen) return;
          setContentCache((prev) => new Map(prev).set(key, null));
        }
      }
    })();
  }, [contentCache, openFiling, openDocuments]);

  useEffect(() => {
    if (filings.length > 0 && selectedIdx >= filings.length) {
      setSelectedIdx(Math.max(0, filings.length - 1));
    }
  }, [filings.length, selectedIdx, setSelectedIdx]);

  // Background prefetch Form 4 content for enriched previews
  const prefetchStartedRef = useRef(new Set<string>());
  useEffect(() => {
    prefetchStartedRef.current.clear();
    documentFetchStartedRef.current.clear();
  }, [eligibleTicker, ticker?.metadata.exchange, ticker?.metadata.ticker]);

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

  const footerInfo = useMemo(() => [
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
  ], [error, loading]);
  useExternalLinkFooter({
    registrationId: "sec",
    focused,
    url: error ? null : openFiling?.filingUrl,
    source: openFiling?.form,
    info: footerInfo,
    label: "filing",
  });

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view SEC filings.</Text>;
  if (!eligibleTicker) return renderFilingNotice("SEC filings are only shown for US equities.", width);
  if (loading && filings.length === 0) return <Spinner label="Loading SEC filings..." />;
  if (error) return renderFilingNotice(`Error: ${error}`, width);
  if (filings.length === 0) return renderFilingNotice(`No recent SEC filings for ${ticker.metadata.ticker}.`, width);

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={toFeedItems(
        filings,
        openFiling?.accessionNumber,
        contentCache,
        loadingContent,
        openDocuments,
        loadingDocuments,
      )}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      sourceLabel="Form"
      titleLabel="Filing"
      emptyStateTitle="No SEC filings."
    />
  );
}

export const secPlugin: GloomPlugin = {
  id: "sec",
  name: "SEC",
  version: "1.0.0",
  description: "Recent SEC filings for US equities",
  toggleable: true,

  panes: [
    {
      id: "sec",
      name: "SEC",
      icon: "S",
      component: SecView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "sec-pane",
      paneId: "sec",
      label: "SEC",
      description: "Recent SEC filings for the selected ticker.",
      keywords: ["sec", "filings", "10-k", "10-q", "8-k"],
      shortcut: "SEC",
      canCreate: (_context, options) => !options?.ticker || isUsEquityTicker(options.ticker),
    }),
  ],

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "sec",
      name: "SEC",
      order: 45,
      component: SecView,
      isVisible: ({ ticker }) => isUsEquityTicker(ticker),
    });
  },
};
