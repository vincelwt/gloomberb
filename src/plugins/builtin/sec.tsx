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

const SEC_FILING_LIMIT = 50;

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

function toFeedItems(
  filings: SecFilingItem[],
  selectedAccessionNumber: string | undefined,
  contentCache: Map<string, string | null>,
  loadingContent: boolean,
): DetailFeedItem[] {
  return filings.map((filing) => {
    const displayTitle = getFilingDisplayTitle(filing);
    const hasFetchedContent = contentCache.has(filing.accessionNumber);
    const fetchedContent = contentCache.get(filing.accessionNumber);
    const fallbackBody = hasFetchedContent && !loadingContent && !fetchedContent
      ? `${buildDetailBody(filing)}\n\nReadable filing content was not available for this document.`
      : buildDetailBody(filing);

    return {
      id: filing.accessionNumber,
      eyebrow: filing.form,
      title: displayTitle,
      timestamp: filing.filingDate,
      preview: filing.items ? `Items ${filing.items}` : filing.primaryDocument,
      detailTitle: displayTitle,
      detailMeta: [
        `Filed ${formatFiledAt(filing)}`,
        `Accession ${filing.accessionNumber}`,
        ...(filing.items ? [`Items ${filing.items}`] : []),
        ...(filing.primaryDocument ? [`Primary document ${filing.primaryDocument}`] : []),
      ],
      detailBody: filing.accessionNumber === selectedAccessionNumber
        ? (
            loadingContent
              ? "Loading filing content..."
              : fetchedContent ?? fallbackBody
          )
        : fallbackBody,
      detailNote: [filing.primaryDocumentUrl, filing.filingUrl].filter(Boolean).join("\n"),
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
