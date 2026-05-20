import type { ReactNode } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { Button, EmptyState, TickerBadgeList } from "../../../components";
import { MarkdownText } from "../../../components/markdown-text";
import { RemoteImage } from "../../../components/ui";
import { colors } from "../../../theme/colors";
import type {
  BuildoutCompany,
  BuildoutObservation,
  BuildoutRelatedCompany,
  BuildoutReportSection,
  BuildoutRow,
  BuildoutSite,
  BuildoutSource,
  RawObject,
} from "./model";
import {
  activityColor,
  activityLabel,
  criticalityColor,
  dateDetail,
  dateShort,
  domainFromUrl,
  favoriteKey,
  intelSourceDomains,
  metricColor,
  rowStarred,
  sourceDomains,
  text,
  textOrNull,
  tickerSymbol,
  truncate,
  uniqueStrings,
} from "./model";

type DetailSpec = {
  label: string;
  value?: string | null;
  color?: string;
};

function DetailSpecGrid({ items, width, marginTop = 1 }: { items: DetailSpec[]; width: number; marginTop?: number }) {
  const visibleItems = items.filter((item) => textOrNull(item.value) != null);
  if (visibleItems.length === 0) return null;

  const columnCount = width >= 110 ? 4 : width >= 78 ? 3 : width >= 52 ? 2 : 1;
  const columnWidth = Math.max(18, Math.floor(width / columnCount));
  const rows: DetailSpec[][] = [];
  for (let index = 0; index < visibleItems.length; index += columnCount) {
    rows.push(visibleItems.slice(index, index + columnCount));
  }

  return (
    <Box marginTop={marginTop} flexDirection="column">
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" height={1} width={width} overflow="hidden">
          {row.map((item) => {
            const labelWidth = Math.min(Math.max(item.label.length + 2, 8), Math.max(8, Math.floor(columnWidth * 0.45)));
            const valueWidth = Math.max(0, columnWidth - labelWidth);
            const labelText = truncate(`${item.label}:`, Math.max(0, labelWidth - 1)).padEnd(labelWidth);
            return (
              <Box key={item.label} flexDirection="row" width={columnWidth} height={1} overflow="hidden">
                <Text fg={colors.textMuted}>{labelText}</Text>
                <Text fg={item.color ?? colors.text}>{truncate(text(item.value, ""), valueWidth)}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
function MetaBadge({ label, tone = "neutral" }: { label?: string | null; tone?: "neutral" | "warning" }) {
  const value = textOrNull(label);
  if (!value) return null;
  const accent = tone === "warning" ? colors.warning : colors.borderFocused;
  return (
    <Box backgroundColor={accent} paddingX={1} height={1}>
      <Text fg={colors.bg} attributes={TextAttributes.BOLD}>{value.toUpperCase()}</Text>
    </Box>
  );
}

function InlineSources({ domains, width }: { domains: readonly string[]; width: number }) {
  if (domains.length === 0) return null;
  const label = "Sources: ";
  return (
    <Box marginTop={1} flexDirection="row" width={width} height={1} overflow="hidden">
      <Text fg={colors.textMuted}>{label}</Text>
      <Text fg={colors.textDim}>{truncate(domains.join(", "), Math.max(0, width - label.length))}</Text>
    </Box>
  );
}

function valueWithOriginal(value?: string | null, original?: string | null) {
  const main = textOrNull(value);
  const originalValue = textOrNull(original);
  if (!originalValue || originalValue === main) return main;
  return main ? `${main} (${originalValue})` : originalValue;
}

function dateCell(value?: string | null) {
  const short = dateShort(value);
  return short === "-" ? null : short;
}

function booleanText(value: boolean | null | undefined) {
  if (value == null) return null;
  return value ? "Yes" : "No";
}

function recommendationColor(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("buy")) return colors.positive;
  if (normalized.includes("sell")) return colors.negative;
  if (normalized.includes("hold")) return colors.neutral;
  return colors.textDim;
}

function detailListValues(values: readonly (string | null | undefined)[], existing: readonly (string | null | undefined)[] = []) {
  const existingSet = new Set(existing.map((item) => item?.trim()).filter(Boolean));
  return uniqueStrings(values.filter((item): item is string => textOrNull(item) != null))
    .filter((item) => !existingSet.has(item));
}

function DetailSection({
  title,
  width,
  children,
}: {
  title: string;
  width: number;
  children: ReactNode;
}) {
  return (
    <Box marginTop={1} flexDirection="column" width={width}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{truncate(title, width)}</Text>
      {children}
    </Box>
  );
}

function DetailListLine({
  label,
  values,
  width,
}: {
  label: string;
  values: readonly string[];
  width: number;
}) {
  if (values.length === 0) return null;
  const prefix = `${label}: `;
  return (
    <Box flexDirection="row" width={width} height={1} overflow="hidden">
      <Text fg={colors.textMuted}>{prefix}</Text>
      <Text fg={colors.textDim}>{truncate(values.join(", "), Math.max(0, width - prefix.length))}</Text>
    </Box>
  );
}

function metadataValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return textOrNull(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return booleanText(value);
  if (Array.isArray(value)) {
    const values = value.map(textOrNull).filter((item): item is string => item != null);
    return values.length > 0 ? values.slice(0, 5).join(", ") : null;
  }
  return null;
}

function metadataLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function metadataSpecs(metadata: RawObject | null | undefined): DetailSpec[] {
  if (!metadata) return [];
  return Object.entries(metadata)
    .flatMap(([key, value]) => {
      const normalized = metadataValue(value);
      return normalized ? [{ label: metadataLabel(key), value: normalized }] : [];
    })
    .slice(0, 12);
}

function RelatedCompaniesLine({
  label,
  companies,
  width,
  catalog,
  openTicker,
}: {
  label: string;
  companies: readonly BuildoutRelatedCompany[] | undefined;
  width: number;
  catalog: Parameters<typeof TickerBadgeList>[0]["catalog"];
  openTicker: (symbol: string) => void;
}) {
  const items = companies ?? [];
  if (items.length === 0) return null;

  const visible = items.slice(0, 8);
  const symbols = visible
    .map((company) => tickerSymbol(company.ticker))
    .filter((symbol): symbol is string => symbol != null);
  const names = visible
    .filter((company) => !tickerSymbol(company.ticker))
    .map((company) => textOrNull(company.name))
    .filter((name): name is string => name != null);
  const overflow = items.length > visible.length ? ` +${items.length - visible.length}` : "";
  const prefix = `${label}: `;
  const badgeWidth = Math.min(Math.max(0, width - prefix.length - (names.length > 0 ? 1 : 0)), Math.max(0, symbols.length * 9));
  return (
    <Box flexDirection="row" width={width} height={1} overflow="hidden">
      <Text fg={colors.textMuted}>{prefix}</Text>
      {symbols.length > 0 ? (
        <TickerBadgeList
          symbols={symbols}
          width={badgeWidth}
          catalog={catalog}
          fallbackColor={colors.textBright}
          openTicker={openTicker}
        />
      ) : null}
      <Text fg={colors.textDim}>
        {truncate(`${names.length > 0 ? names.join(", ") : ""}${overflow}`, Math.max(0, width - prefix.length - badgeWidth))}
      </Text>
    </Box>
  );
}

function SourceDetailLines({
  sources,
  width,
  maxItems = 3,
}: {
  sources: readonly BuildoutSource[] | undefined;
  width: number;
  maxItems?: number;
}) {
  const entries = (sources ?? [])
    .flatMap((source) => {
      const flatUrl = source.url;
      const flatTitle = source.title ?? source.snippet ?? source.reasoning;
      const flat = flatUrl || flatTitle
        ? [{
          domain: source.domain ?? domainFromUrl(flatUrl) ?? null,
          title: flatTitle,
          note: source.reasoning ?? source.snippet,
          tier: source.tier,
        }]
        : [];
      const citations = (source.citations ?? []).map((citation) => ({
        domain: domainFromUrl(citation.url) ?? null,
        title: citation.title ?? citation.excerpts?.[0] ?? null,
        note: citation.excerpts?.[0] ?? null,
        tier: source.tier,
      }));
      return [...flat, ...citations];
    })
    .filter((entry) => textOrNull(entry.domain ?? entry.title ?? entry.note) != null)
    .slice(0, maxItems);

  if (entries.length === 0) return null;
  return (
    <Box marginTop={1} flexDirection="column" width={width}>
      {entries.map((entry, index) => {
        const prefix = entry.domain ? `${entry.domain}${entry.tier ? ` T${entry.tier}` : ""}: ` : "";
        const body = entry.title ?? entry.note ?? "";
        return (
          <Text key={`${entry.domain ?? "source"}:${index}`} fg={colors.textMuted}>
            {truncate(`${prefix}${body}`, width)}
          </Text>
        );
      })}
    </Box>
  );
}

export function CompaniesUpgradeCta({
  hiddenCount,
  width,
  busy,
  message,
  onUpgrade,
}: {
  hiddenCount: number;
  width: number;
  busy: boolean;
  message: string | null;
  onUpgrade: () => void;
}) {
  if (hiddenCount <= 0) return null;
  const noun = hiddenCount === 1 ? "company" : "companies";
  const contentWidth = Math.max(20, width - 2);
  const title = truncate(`${hiddenCount} more ${noun} available`, contentWidth).padEnd(contentWidth);
  const subtitle = truncate("Upgrade to unlock the full list and company profiles under $10B market cap.", contentWidth).padEnd(contentWidth);
  const note = (message ? truncate(message, contentWidth) : "").padEnd(contentWidth);
  return (
    <Box
      flexDirection="column"
      height={message ? 6 : 5}
      width="100%"
      paddingX={1}
      backgroundColor={colors.panel}
      overflow="hidden"
    >
      <Box height={1} width="100%" backgroundColor={colors.panel}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
      </Box>
      <Box height={1} width="100%" backgroundColor={colors.panel}>
        <Text fg={colors.textDim}>{subtitle}</Text>
      </Box>
      <Box height={1} width="100%" backgroundColor={colors.panel} />
      <Box flexDirection="row" height={1} width="100%" backgroundColor={colors.panel}>
        <Button
          label={busy ? "Opening..." : "Upgrade to Pro"}
          variant="primary"
          disabled={busy}
          onPress={onUpgrade}
        />
      </Box>
      {message ? (
        <Box height={1} width="100%" backgroundColor={colors.panel}>
          <Text fg={colors.warning}>{note}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function MarkdownBlock({
  text: markdown,
  width,
  catalog,
  openTicker,
  marginTop = 1,
}: {
  text?: string | null;
  width: number;
  catalog: Parameters<typeof TickerBadgeList>[0]["catalog"];
  openTicker: (symbol: string) => void;
  marginTop?: number;
}) {
  if (!markdown) return null;
  return (
    <Box marginTop={marginTop}>
      <MarkdownText
        text={markdown}
        lineWidth={width}
        textColor={colors.textDim}
        catalog={catalog}
        openTicker={openTicker}
      />
    </Box>
  );
}

export function tickerBadges({
  symbols,
  width,
  catalog,
  openTicker,
  fallbackColor,
}: {
  symbols: readonly string[];
  width: number;
  catalog: Parameters<typeof TickerBadgeList>[0]["catalog"];
  openTicker: (symbol: string) => void;
  fallbackColor?: string;
}) {
  if (symbols.length === 0) return null;
  return (
    <TickerBadgeList
      symbols={symbols}
      width={width}
      catalog={catalog}
      fallbackColor={fallbackColor}
      openTicker={openTicker}
    />
  );
}

export function FavoriteCell({
  starred,
  busy,
  selected,
  interactive = false,
  onPress,
}: {
  starred: boolean;
  busy: boolean;
  selected: boolean;
  interactive?: boolean;
  onPress?: () => void;
}) {
  const color = selected
    ? colors.selectedText
    : busy ? colors.textMuted : starred ? colors.warning : colors.textMuted;
  return (
    <Box
      width={2}
      height={1}
      style={{ cursor: interactive && !busy ? "pointer" : "default" }}
      onMouseDown={onPress ? (event: any) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!busy) onPress();
      } : undefined}
    >
      <Text fg={color} attributes={starred ? TextAttributes.BOLD : TextAttributes.NONE} selectable={false}>
        {busy ? "*" : starred ? "★" : "☆"}
      </Text>
    </Box>
  );
}

export function CompanyCell({
  company,
  width,
  selected,
  catalog,
  openTicker,
}: {
  company: BuildoutCompany;
  width: number;
  selected: boolean;
  catalog: Parameters<typeof TickerBadgeList>[0]["catalog"];
  openTicker: (symbol: string) => void;
}) {
  const symbol = tickerSymbol(company.ticker);
  if (!symbol) {
    return <Text fg={selected ? colors.selectedText : colors.text}>{truncate(company.name, width)}</Text>;
  }
  const badgeWidth = Math.min(11, width);
  return (
    <Box flexDirection="row" width={width} height={1} overflow="hidden">
      <TickerBadgeList
        symbols={[symbol]}
        width={badgeWidth}
        catalog={catalog}
        fallbackColor={selected ? colors.selectedText : colors.textBright}
        openTicker={openTicker}
      />
      <Text fg={selected ? colors.selectedText : colors.text}>
        {truncate(company.name, Math.max(0, width - badgeWidth))}
      </Text>
    </Box>
  );
}

function observationImageUrl(observation: BuildoutObservation) {
  return observation.upscaledImageUrl
    ?? observation.imageUrl
    ?? observation.originalImageUrl
    ?? observation.swirImageUrl
    ?? observation.nirImageUrl
    ?? null;
}

function pickObservationImages(observations: readonly BuildoutObservation[]) {
  const seen = new Set<string>();
  const preferred = [
    observations.find((item) => item.observationSource === "sentinel2" && observationImageUrl(item)),
    observations.find((item) => item.observationSource === "sentinel1" && observationImageUrl(item)),
    ...observations.filter((item) => observationImageUrl(item)),
  ].filter((item): item is BuildoutObservation => item != null);

  return preferred.filter((item) => {
    const url = observationImageUrl(item);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 2);
}

function SiteSatelliteImages({
  site,
  width,
  height,
}: {
  site: BuildoutSite;
  width: number;
  height: number;
}) {
  const observations = site.observations ?? [];
  if (observations.length === 0) return null;

  const imageWidth = Math.max(20, Math.min(width, 96));
  const imageHeight = Math.max(6, Math.min(18, Math.floor(height / 3)));
  const imageObservations = pickObservationImages(observations);

  if (imageObservations.length === 0) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text fg={colors.textDim}>Satellite Observations</Text>
        <Text fg={colors.textMuted}>
          {`${observations.length} captures available. Image URLs require pro access.`}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column" gap={1}>
      <Text fg={colors.textDim}>Satellite Observations</Text>
      {imageObservations.map((observation, index) => {
        const url = observationImageUrl(observation);
        if (!url) return null;
        const source = observation.observationSource === "sentinel1" ? "Radar" : "Optical";
        const label = `${source} ${dateShort(observation.captureDate)}`;
        return (
          <RemoteImage
            key={observation.id ?? `${url}:${index}`}
            src={url}
            alt={`${site.name} satellite observation`}
            width={imageWidth}
            height={imageHeight}
            label={label}
          />
        );
      })}
    </Box>
  );
}

function reportSectionText(section: BuildoutReportSection) {
  return section.markdown ?? section.body ?? section.content ?? section.section ?? null;
}

export function BuildoutDetail({
  row,
  width,
  height,
  catalog,
  openTicker,
  canFavorite,
  favoriteBusyKey,
  onToggleFavorite,
}: {
  row: BuildoutRow | null;
  width: number;
  height: number;
  catalog: Parameters<typeof TickerBadgeList>[0]["catalog"];
  openTicker: (symbol: string) => void;
  canFavorite: boolean;
  favoriteBusyKey: string | null;
  onToggleFavorite: (row: BuildoutRow) => void;
}) {
  if (!row) return <EmptyState title="No row selected." />;

  const bodyWidth = Math.max(width - 2, 20);
  const rowFavoriteKey = favoriteKey(row);
  const favoriteToggle = canFavorite && rowFavoriteKey ? (
    <FavoriteCell
      starred={rowStarred(row)}
      busy={favoriteBusyKey === rowFavoriteKey}
      selected={false}
      interactive
      onPress={() => onToggleFavorite(row)}
    />
  ) : null;
  return (
    <ScrollBox width={width} height={height}>
      <Box flexDirection="column" paddingX={1} width={bodyWidth}>
        {row.kind === "company" && (() => {
          const company = row.item;
          const categoryAnchor = [company.primarySector, company.primarySubsector, company.primaryTechnology];
          const sectors = detailListValues(company.sectors ?? [], [company.primarySector]);
          const subSectors = detailListValues(company.subSectors ?? [], [company.primarySubsector]);
          const technologies = detailListValues(company.technologies ?? [], [company.primaryTechnology]);
          const valueChainStages = detailListValues(company.valueChainStages ?? [], categoryAnchor);
          const hasCategories = sectors.length > 0 || subSectors.length > 0 || technologies.length > 0 || valueChainStages.length > 0;
          const supplyChain = company.supplyChain;
          const hasSupplyChain = (supplyChain?.suppliers.length ?? 0) > 0
            || (supplyChain?.customers.length ?? 0) > 0
            || (supplyChain?.competitors.length ?? 0) > 0
            || textOrNull(company.aiCriticalityJustification) != null;
          return (
            <>
              {favoriteToggle || company.ticker ? (
                <Box flexDirection="row" height={1} gap={1}>
                  {favoriteToggle}
                  {company.ticker ? tickerBadges({
                    symbols: [company.ticker],
                    width: Math.min(bodyWidth - (favoriteToggle ? 3 : 0), 16),
                    catalog,
                    openTicker,
                  }) : null}
                </Box>
              ) : null}
              <DetailSpecGrid
                width={bodyWidth}
                items={[
                  { label: "Exchange", value: company.exchange },
                  { label: "Price", value: valueWithOriginal(company.stockPrice, company.stockPriceOriginal), color: metricColor(company.return1y) },
                  { label: "1Y", value: company.return1y, color: metricColor(company.return1y) },
                  { label: "3Y", value: company.return3y, color: metricColor(company.return3y) },
                  { label: "Sector", value: [company.primarySector, company.primarySubsector, company.primaryTechnology].filter(Boolean).join(" / ") },
                  { label: "Critical", value: company.aiCriticality, color: criticalityColor(company.aiCriticality, false) },
                  { label: "Maturity", value: company.maturity },
                  { label: "Export", value: company.exportControlExposure },
                  { label: "Employees", value: company.employeeCount },
                  { label: "HQ", value: company.hqAddress ?? [company.city, company.state, company.countryHq].filter(Boolean).join(", ") },
                  { label: "Currency", value: company.currency && company.currency !== "USD" ? company.currency : null },
                ]}
              />
              <MarkdownBlock text={company.listReason} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
              <MarkdownBlock text={company.longDescription ?? company.description} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
              {hasCategories ? (
                <DetailSection title="Categories" width={bodyWidth}>
                  <DetailListLine label="Sectors" values={sectors} width={bodyWidth} />
                  <DetailListLine label="Subsectors" values={subSectors} width={bodyWidth} />
                  <DetailListLine label="Technologies" values={technologies} width={bodyWidth} />
                  <DetailListLine label="Chain" values={valueChainStages} width={bodyWidth} />
                </DetailSection>
              ) : null}
              {hasSupplyChain ? (
                <DetailSection title="Supply Chain" width={bodyWidth}>
                  <MarkdownBlock text={company.aiCriticalityJustification} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                  <RelatedCompaniesLine label="Suppliers" companies={supplyChain?.suppliers} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
                  <RelatedCompaniesLine label="Customers" companies={supplyChain?.customers} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
                  <RelatedCompaniesLine label="Competitors" companies={supplyChain?.competitors} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
                </DetailSection>
              ) : null}
              <DetailSection title="Valuation & Trading" width={bodyWidth}>
                <DetailSpecGrid
                  width={bodyWidth}
                  marginTop={0}
                  items={[
                    { label: "Mkt Cap", value: valueWithOriginal(company.marketCap, company.marketCapOriginal) },
                    { label: "EV", value: company.enterpriseValue },
                    { label: "Fwd P/E", value: company.forwardPE },
                    { label: "Trail P/E", value: company.trailingPE },
                    { label: "P/E", value: company.peRatio },
                    { label: "PEG", value: company.pegRatio },
                    { label: "P/B", value: company.priceToBook },
                    { label: "EPS", value: valueWithOriginal(company.dilutedEps, company.dilutedEpsOriginal) },
                    { label: "Beta", value: company.beta },
                    { label: "52W High", value: valueWithOriginal(company.high52w, company.high52wOriginal) },
                    { label: "52W Low", value: valueWithOriginal(company.low52w, company.low52wOriginal) },
                  ]}
                />
              </DetailSection>
              <DetailSection title="Operating Metrics" width={bodyWidth}>
                <DetailSpecGrid
                  width={bodyWidth}
                  marginTop={0}
                  items={[
                    { label: "Revenue", value: valueWithOriginal(company.revenue, company.revenueOriginal) },
                    { label: "Net Inc", value: valueWithOriginal(company.netIncome, company.netIncomeOriginal), color: metricColor(company.netIncome) },
                    { label: "Rev Grw", value: company.revenueGrowthYoy, color: metricColor(company.revenueGrowthYoy) },
                    { label: "Last Q", value: company.lastQuarterGrowth, color: metricColor(company.lastQuarterGrowth) },
                    { label: "Gross Mgn", value: company.grossProfitMargin, color: metricColor(company.grossProfitMargin) },
                    { label: "Op Mgn", value: company.operatingMargin, color: metricColor(company.operatingMargin) },
                    { label: "Profit Mgn", value: company.profitMargins ?? company.netProfitMargin, color: metricColor(company.profitMargins ?? company.netProfitMargin) },
                    { label: "ROE", value: company.returnOnEquity, color: metricColor(company.returnOnEquity) },
                    { label: "ROA", value: company.returnOnAssets, color: metricColor(company.returnOnAssets) },
                  ]}
                />
              </DetailSection>
              <DetailSection title="Cash & Balance" width={bodyWidth}>
                <DetailSpecGrid
                  width={bodyWidth}
                  marginTop={0}
                  items={[
                    { label: "FCF", value: valueWithOriginal(company.freeCashFlow, company.freeCashFlowOriginal), color: metricColor(company.freeCashFlow) },
                    { label: "OCF", value: company.operatingCashFlow, color: metricColor(company.operatingCashFlow) },
                    { label: "Cash", value: valueWithOriginal(company.totalCash, company.totalCashOriginal) },
                    { label: "Debt", value: valueWithOriginal(company.totalDebt, company.totalDebtOriginal) },
                    { label: "D/E", value: company.debtToEquity },
                    { label: "Current", value: company.currentRatio },
                    { label: "Quick", value: company.quickRatio },
                    { label: "Div Yld", value: company.dividendYield, color: metricColor(company.dividendYield) },
                    { label: "Ex-Div", value: dateCell(company.exDividendDate) },
                    { label: "Div Date", value: dateCell(company.dividendDate) },
                    { label: "Earnings", value: dateCell(company.nextEarningsDate) },
                  ]}
                />
              </DetailSection>
              <DetailSection title="Analyst & Ownership" width={bodyWidth}>
                <DetailSpecGrid
                  width={bodyWidth}
                  marginTop={0}
                  items={[
                    { label: "Target Low", value: valueWithOriginal(company.targetLowPrice, company.targetLowPriceOriginal) },
                    { label: "Target Mean", value: valueWithOriginal(company.targetMeanPrice, company.targetMeanPriceOriginal) },
                    { label: "Target High", value: valueWithOriginal(company.targetHighPrice, company.targetHighPriceOriginal) },
                    { label: "Analysts", value: company.analystCount },
                    { label: "Rec", value: company.recommendation, color: recommendationColor(company.recommendation) },
                    { label: "Strong Buy", value: company.strongBuy },
                    { label: "Buy", value: company.buy },
                    { label: "Hold", value: company.hold },
                    { label: "Sell", value: company.sell },
                    { label: "Strong Sell", value: company.strongSell },
                    { label: "Insiders", value: company.heldByInsiders },
                    { label: "Institutions", value: company.heldByInstitutions },
                    { label: "Short", value: company.sharesShort },
                    { label: "Short Ratio", value: company.shortRatio },
                    { label: "Shares", value: company.sharesOutstanding },
                    { label: "Float", value: company.floatShares },
                  ]}
                />
              </DetailSection>
              {(company.sites?.length ?? 0) > 0 ? (
                <DetailSection title="Sites" width={bodyWidth}>
                  {company.sites!.slice(0, 12).map((site, index) => {
                    const activity = site.constructionActivity != null ? `construction ${activityLabel(site.constructionActivity)}` : null;
                    const parts = [
                      site.name ?? "Site",
                      site.type,
                      site.relationship === "involved" ? site.role : site.relationship,
                      site.powerCapacity,
                      site.areaKm2,
                      [site.location?.city, site.location?.country].filter(Boolean).join(", "),
                      activity,
                    ].filter(Boolean);
                    return (
                      <Box key={`${site.name}-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                        <Text fg={colors.textMuted}>{truncate(parts.join(" - "), bodyWidth)}</Text>
                        {site.involvementSummary ? (
                          <MarkdownBlock text={site.involvementSummary} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                        ) : null}
                      </Box>
                    );
                  })}
                </DetailSection>
              ) : null}
              {(company.intelligence?.length ?? 0) > 0 ? (
                <DetailSection title="Recent Intel" width={bodyWidth}>
                  {company.intelligence!.slice(0, 5).map((item, index) => (
                    <Box key={`${item.headline ?? "intel"}:${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                      <Text fg={colors.textDim}>{truncate(`${dateShort(item.publishedAt)} ${item.headline ?? ""}`, bodyWidth)}</Text>
                      <MarkdownBlock text={item.content} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                    </Box>
                  ))}
                </DetailSection>
              ) : null}
              {company.researchReport ? (
                <DetailSection title="Research" width={bodyWidth}>
                  <MarkdownBlock text={company.researchReport} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                </DetailSection>
              ) : null}
            </>
          );
        })()}
        {row.kind === "site" && (() => {
          const site = row.item;
          const sourceList = [...(site.discoverySources ?? []), ...(site.projectReportSources ?? [])];
          return (
            <>
              {favoriteToggle || site.ownerTicker ? (
                <Box flexDirection="row" height={1} gap={1}>
                  {favoriteToggle}
                  {site.ownerTicker ? tickerBadges({
                    symbols: [site.ownerTicker],
                    width: Math.min(bodyWidth - (favoriteToggle ? 3 : 0), 16),
                    catalog,
                    openTicker,
                  }) : null}
                </Box>
              ) : null}
              <DetailSpecGrid
                width={bodyWidth}
                items={[
                  { label: "Type", value: site.type },
                  { label: "Owner", value: site.ownerName ?? site.ownerTicker },
                  { label: "Location", value: [site.location?.city, site.location?.country].filter(Boolean).join(", ") },
                  { label: "Address", value: site.address },
                  { label: "Park", value: site.parkName },
                  { label: "Power/Cap", value: site.powerCapacity },
                  { label: "ETA", value: site.eta },
                  { label: "Area", value: site.areaKm2 },
                  { label: "Boundary", value: booleanText(site.boundaryConfirmed) },
                  { label: "Construction", value: site.constructionActivity == null ? null : activityLabel(site.constructionActivity), color: activityColor(site.constructionActivity, false) },
                  { label: "Parking", value: site.parkingActivity == null ? null : activityLabel(site.parkingActivity), color: activityColor(site.parkingActivity, false) },
                  { label: "Last Sat", value: dateCell(site.latestCapture) },
                  { label: "Activity At", value: dateCell(site.activityUpdatedAt) },
                  { label: "Enriched", value: dateCell(site.lastEnrichedAt) },
                ]}
              />
              <InlineSources domains={sourceDomains(sourceList)} width={bodyWidth} />
              <SourceDetailLines sources={sourceList} width={bodyWidth} />
              <MarkdownBlock text={site.description} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
              <SiteSatelliteImages site={site} width={bodyWidth} height={height} />
              {(site.observations?.length ?? 0) > 0 ? (
                <DetailSection title="Recent Captures" width={bodyWidth}>
                  {site.observations!.slice(0, 8).map((observation, index) => {
                    const bounds = observation.captureBounds?.minLat != null && observation.captureBounds?.minLng != null
                      ? `${observation.captureBounds.minLat.toFixed(3)}, ${observation.captureBounds.minLng.toFixed(3)}`
                      : null;
                    return (
                      <Text key={observation.id ?? index} fg={colors.textMuted}>
                        {truncate([
                          dateShort(observation.captureDate),
                          observation.observationSource,
                          observation.note,
                          bounds,
                        ].filter(Boolean).join(" - "), bodyWidth)}
                      </Text>
                    );
                  })}
                </DetailSection>
              ) : null}
              {metadataSpecs(site.siteMetadata).length > 0 ? (
                <DetailSection title="Specs" width={bodyWidth}>
                  <DetailSpecGrid width={bodyWidth} marginTop={0} items={metadataSpecs(site.siteMetadata)} />
                </DetailSection>
              ) : null}
              {(site.projectReportSections?.length ?? 0) > 0 ? (
                <DetailSection title="Project Report" width={bodyWidth}>
                  {site.projectReportSections!.map((section, index) => (
                    <Box key={`${section.title ?? "section"}:${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                      {section.title ? <Text fg={colors.textDim}>{section.title}</Text> : null}
                      <MarkdownBlock text={reportSectionText(section)} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                    </Box>
                  ))}
                </DetailSection>
              ) : null}
              {site.researchReport ? (
                <DetailSection title="Research" width={bodyWidth}>
                  <MarkdownBlock text={site.researchReport} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                </DetailSection>
              ) : null}
              {(site.builders?.length ?? 0) > 0 ? (
                <DetailSection title="Involved Companies" width={bodyWidth}>
                  {site.builders!.slice(0, 12).map((builder, index) => (
                    <Box key={`${builder.companyName}-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
                      <Box flexDirection="row" height={1}>
                        {builder.companyTicker
                          ? tickerBadges({
                            symbols: [builder.companyTicker],
                            width: Math.min(12, bodyWidth),
                            catalog,
                            openTicker,
                          })
                          : null}
                        <Text fg={colors.textMuted}>
                          {truncate(`${builder.companyName ?? "Company"}${builder.role ? ` - ${builder.role}` : ""}`, Math.max(0, bodyWidth - (builder.companyTicker ? 12 : 0)))}
                        </Text>
                      </Box>
                      <MarkdownBlock text={builder.summary} width={bodyWidth} catalog={catalog} openTicker={openTicker} marginTop={0} />
                    </Box>
                  ))}
                </DetailSection>
              ) : null}
            </>
          );
        })()}
        {row.kind === "intel" && (
          <>
            <Box flexDirection="row" height={1} gap={1} overflow="hidden">
              <MetaBadge label={row.item.type} />
              {row.item.publishedAt ? <Text fg={colors.textDim}>{dateDetail(row.item.publishedAt)}</Text> : null}
            </Box>
            {(row.item.companies?.length ?? 0) > 0 && (
              <Box marginTop={1} height={1}>
                {tickerBadges({
                  symbols: row.item.companies!.map((company) => tickerSymbol(company.ticker) ?? "").filter(Boolean),
                  width: Math.min(bodyWidth, 56),
                  catalog,
                  openTicker,
                })}
              </Box>
            )}
            {row.item.imageUrl ? (
              <Box marginTop={1}>
                <RemoteImage
                  src={row.item.imageUrl}
                  alt={row.item.headline}
                  width={Math.min(bodyWidth, 96)}
                  height={Math.max(6, Math.min(16, Math.floor(height / 3)))}
                  label="image"
                />
              </Box>
            ) : null}
            <MarkdownBlock text={row.item.context ?? row.item.content} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
            {row.item.context && row.item.content && row.item.context !== row.item.content
              ? <MarkdownBlock text={row.item.content} width={bodyWidth} catalog={catalog} openTicker={openTicker} />
              : null}
            <InlineSources domains={intelSourceDomains(row.item)} width={bodyWidth} />
          </>
        )}
      </Box>
    </ScrollBox>
  );
}
