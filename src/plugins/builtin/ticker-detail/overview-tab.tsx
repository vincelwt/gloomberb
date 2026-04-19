import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { useViewport } from "../../../react/input";
import { useFxRatesMap } from "../../../market-data/hooks";
import { useAppSelector } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import {
  convertCurrency,
  displayWidth,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPercentRaw,
  padTo,
} from "../../../utils/format";
import { formatMarketCostWithCurrency, formatMarketPriceWithCurrency, formatMarketQuantity, formatSignedMarketPrice } from "../../../utils/market-format";
import {
  exchangeShortName,
  marketStateColor,
  marketStateLabel,
  quoteSourceLabel,
} from "../../../utils/market-status";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { EmptyState } from "../../../components";
import { ResolvedStockChart } from "../../../components/chart/stock-chart";
import type { Quote, TickerFinancials } from "../../../types/financials";
import type { TickerPosition, TickerRecord } from "../../../types/ticker";

const STAT_COLUMN_GAP = 2;
const STAT_LABEL_WIDTH = 12;
const BOOK_LABEL_WIDTH = 4;
const RANGE_ENDPOINT_WIDTH = 11;
const RANGE_MAX_WIDTH = 42;
const POSITION_COLUMN_GAP = 1;

function CompactRangeBar({
  current,
  low,
  high,
  label,
  width,
  currency,
  assetCategory,
  markerColor,
}: {
  current: number;
  low: number;
  high: number;
  label: string;
  width: number;
  currency: string;
  assetCategory?: string;
  markerColor: string;
}) {
  const range = high - low;
  if (range <= 0) return null;
  const position = Math.max(0, Math.min(1, (current - low) / range));
  const pctLabel = `${Math.round(position * 100)}%`;
  const lowText = formatMarketPriceWithCurrency(low, currency, { assetCategory });
  const highText = formatMarketPriceWithCurrency(high, currency, { assetCategory });
  const endpointWidth = Math.min(
    RANGE_ENDPOINT_WIDTH,
    Math.max(7, Math.floor((width - 8) / 3)),
  );
  const barWidth = Math.max(5, width - endpointWidth * 2 - 2);
  const markerIndex = Math.max(0, Math.min(barWidth - 1, Math.round(position * (barWidth - 1))));
  const labelWidth = Math.max(0, width - displayWidth(pctLabel));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textDim}>{padTo(label, labelWidth)}</Text>
        <Text fg={markerColor}>{pctLabel}</Text>
      </Box>
      <Box flexDirection="row" height={1}>
        <Text fg={colors.textDim}>
          {padTo(lowText, endpointWidth)}
        </Text>
        <Box marginLeft={1} marginRight={1} width={barWidth} flexDirection="row">
          <Text fg={colors.border}>{"─".repeat(markerIndex)}</Text>
          <Text fg={markerColor}>{"●"}</Text>
          <Text fg={colors.border}>{"─".repeat(Math.max(0, barWidth - markerIndex - 1))}</Text>
        </Box>
        <Text fg={colors.textDim}>
          {padTo(highText, endpointWidth, "right")}
        </Text>
      </Box>
    </Box>
  );
}

function BookRow({
  label,
  value,
  width,
  valueColor,
}: {
  label: string;
  value: string;
  width: number;
  valueColor: string;
}) {
  return (
    <Box flexDirection="row" height={1} width={width}>
      <Text fg={colors.textDim}>{padTo(label, BOOK_LABEL_WIDTH)}</Text>
      <Text fg={valueColor}>{value}</Text>
    </Box>
  );
}

function QuoteBook({ quote, assetCategory, width }: { quote: Quote; assetCategory?: string; width: number }) {
  const bidPrice = quote.bid != null
    ? formatMarketPriceWithCurrency(quote.bid, quote.currency, { assetCategory })
    : "—";
  const askPrice = quote.ask != null
    ? formatMarketPriceWithCurrency(quote.ask, quote.currency, { assetCategory })
    : "—";
  const bidText = quote.bidSize != null && quote.bidSize > 0 ? `${formatNumber(quote.bidSize, 0)} x ${bidPrice}` : bidPrice;
  const askText = quote.askSize != null && quote.askSize > 0 ? `${formatNumber(quote.askSize, 0)} x ${askPrice}` : askPrice;
  let spreadText = "—";
  if (quote.bid != null && quote.ask != null) {
    const spread = quote.ask - quote.bid;
    const mid = (quote.ask + quote.bid) / 2;
    const spreadPercent = mid > 0 ? ` (${((spread / mid) * 100).toFixed(2)}%)` : "";
    spreadText = `${formatMarketPriceWithCurrency(spread, quote.currency, { assetCategory })}${spreadPercent}`;
  }

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <BookRow label="Bid" value={bidText} width={width} valueColor={colors.borderFocused} />
      <BookRow label="Ask" value={askText} width={width} valueColor={colors.negative} />
      <BookRow label="Spr" value={spreadText} width={width} valueColor={colors.textDim} />
    </Box>
  );
}

interface StatField {
  label: string;
  value: string;
  valueColor?: string;
}

interface PositionTableRow {
  account: string;
  qty: string;
  avg: string;
  mark: string;
  cost: string;
  value: string;
  pnl: string;
  ret: string;
  pnlValue: number | null;
}

interface PositionColumn {
  key: keyof Omit<PositionTableRow, "pnlValue">;
  label: string;
  width: number;
  align?: "left" | "right";
  color?: (row: PositionTableRow) => string;
}

function StatGrid({ fields, width }: { fields: StatField[]; width: number }) {
  const columnCount = width >= 58 ? 2 : 1;
  const colWidth = Math.floor((width - STAT_COLUMN_GAP * (columnCount - 1)) / columnCount);
  const rows: Array<Array<StatField | null>> = [];
  for (let i = 0; i < fields.length; i += columnCount) {
    rows.push(Array.from({ length: columnCount }, (_, offset) => fields[i + offset] ?? null));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={i} flexDirection="row" height={1}>
          {row.map((field, j) => {
            if (!field) {
              return (
                <Box key={j} flexDirection="row">
                  {j > 0 && <Box width={STAT_COLUMN_GAP} />}
                  <Box width={colWidth} />
                </Box>
              );
            }
            const labelWidth = Math.min(STAT_LABEL_WIDTH, Math.max(8, Math.floor(colWidth * 0.45)));
            const valueWidth = Math.max(1, colWidth - labelWidth);
            return (
              <Box key={j} flexDirection="row">
                {j > 0 && <Box width={STAT_COLUMN_GAP} />}
                <Box width={colWidth} flexDirection="row">
                  <Text fg={colors.textDim}>{padTo(field.label, labelWidth)}</Text>
                  <Text fg={field.valueColor ?? colors.text}>{padTo(field.value, valueWidth, "right")}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <Box height={1}>
      <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>{title}</Text>
    </Box>
  );
}

function compactPositionAccount(position: TickerPosition): string {
  const rawAccount = position.brokerAccountId || position.portfolio;
  const isBrokerPortfolio = rawAccount.startsWith("broker:");
  const account = isBrokerPortfolio
    ? rawAccount.split(":").filter(Boolean).at(-1) || rawAccount
    : rawAccount;
  const prefix = !isBrokerPortfolio && position.broker && position.broker !== "manual" ? `${position.broker} ` : "";
  const suffix = position.side === "short" ? " SHORT" : "";
  return `${prefix}${account}${suffix}`;
}

function createPositionColumns(width: number): PositionColumn[] {
  const columns: PositionColumn[] = width >= 84
    ? [
        { key: "account", label: "Account", width: 0 },
        { key: "qty", label: "Qty", width: 8, align: "right" },
        { key: "avg", label: "Avg", width: 9, align: "right" },
        { key: "mark", label: "Mark", width: 9, align: "right" },
        { key: "cost", label: "Cost", width: 11, align: "right" },
        { key: "value", label: "Value", width: 11, align: "right" },
        { key: "pnl", label: "P&L", width: 12, align: "right", color: (row) => priceColor(row.pnlValue ?? 0) },
        { key: "ret", label: "Ret", width: 7, align: "right", color: (row) => priceColor(row.pnlValue ?? 0) },
      ]
    : width >= 70
      ? [
          { key: "account", label: "Account", width: 0 },
          { key: "qty", label: "Qty", width: 8, align: "right" },
          { key: "avg", label: "Avg", width: 9, align: "right" },
          { key: "mark", label: "Mark", width: 9, align: "right" },
          { key: "value", label: "Value", width: 11, align: "right" },
          { key: "pnl", label: "P&L", width: 12, align: "right", color: (row) => priceColor(row.pnlValue ?? 0) },
        ]
      : [
          { key: "account", label: "Account", width: 0 },
          { key: "qty", label: "Qty", width: 8, align: "right" },
          { key: "value", label: "Value", width: 11, align: "right" },
          { key: "pnl", label: "P&L", width: 12, align: "right", color: (row) => priceColor(row.pnlValue ?? 0) },
        ];
  const fixedWidth = columns.reduce((sum, column) => sum + column.width, 0) + POSITION_COLUMN_GAP * (columns.length - 1);
  const accountColumn = columns[0]!;
  accountColumn.width = Math.max(8, width - fixedWidth);
  return columns;
}

function PositionTable({ rows, width }: { rows: PositionTableRow[]; width: number }) {
  const columns = createPositionColumns(width);

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" height={1}>
        {columns.map((column, index) => (
          <Box key={column.key} flexDirection="row">
            {index > 0 && <Box width={POSITION_COLUMN_GAP} />}
            <Text fg={colors.textDim}>{padTo(column.label, column.width, column.align)}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" height={1}>
          {columns.map((column, index) => (
            <Box key={column.key} flexDirection="row">
              {index > 0 && <Box width={POSITION_COLUMN_GAP} />}
              <Text fg={column.color?.(row) ?? (column.key === "account" ? colors.textBright : colors.text)}>
                {padTo(row[column.key], column.width, column.align)}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function OverviewTab({
  width,
  symbol,
  ticker,
  financials,
}: {
  width?: number;
  symbol: string | null;
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
}) {
  const baseCurrency = useAppSelector((state) => state.config.baseCurrency);
  const exchangeRatesState = useAppSelector((state) => state.exchangeRates);
  const { width: termWidth } = useViewport();

  if (!ticker) return <EmptyState title="No ticker selected." />;

  const quote = financials?.quote;
  const fundamentals = financials?.fundamentals;
  const profile = financials?.profile;
  const exchangeRates = useFxRatesMap([
    baseCurrency,
    ticker.metadata.currency,
    quote?.currency,
    ...ticker.metadata.positions.map((position) => position.currency),
  ]);
  const effectiveExchangeRates = selectEffectiveExchangeRates(exchangeRates, exchangeRatesState);
  const quoteCurrency = quote?.currency ?? ticker.metadata.currency ?? baseCurrency;
  const toBase = (value: number, fromCurrency: string) =>
    convertCurrency(value, fromCurrency, baseCurrency, effectiveExchangeRates);
  const sector = ticker.metadata.sector ?? profile?.sector;
  const industry = ticker.metadata.industry ?? profile?.industry;
  const description = profile?.description?.trim();
  const listingVenue = exchangeShortName(
    quote?.listingExchangeName ?? quote?.exchangeName,
    quote?.listingExchangeFullName ?? quote?.fullExchangeName,
  );
  const routingVenue = exchangeShortName(quote?.routingExchangeName, quote?.routingExchangeFullName);
  const priceSource = quote?.provenance?.price ? quoteSourceLabel(quote.provenance.price, "price") : "";
  const sessionSource = quote?.provenance?.session ? quoteSourceLabel(quote.provenance.session, "session") : "";
  const sourceSummary = priceSource && sessionSource && priceSource !== sessionSource
    ? `src ${priceSource}/${sessionSource}`
    : priceSource || sessionSource
      ? `src ${priceSource || sessionSource}`
      : "";
  const metadataParts = [
    sourceSummary,
    routingVenue && routingVenue !== listingVenue ? `route ${routingVenue}` : "",
  ].filter((part) => part.length > 0);

  const contentWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const chartWidth = contentWidth;
  const hasHistory = (financials?.priceHistory?.length ?? 0) > 2;
  const hasBidAsk = quote?.bid != null || quote?.ask != null;
  const quoteBookInline = hasBidAsk && contentWidth >= 68;
  const quoteBookWidth = quoteBookInline ? Math.min(32, Math.max(24, Math.floor(contentWidth * 0.3))) : Math.min(contentWidth, 32);
  const quoteSummaryWidth = quoteBookInline ? Math.max(20, contentWidth - quoteBookWidth - 2) : contentWidth;
  const hasDayRange = quote?.low != null && quote?.high != null && quote.high > quote.low;
  const hasYearRange = quote?.low52w != null && quote?.high52w != null && quote.high52w > quote.low52w;
  const rangeInline = contentWidth >= 70 && hasDayRange && hasYearRange;
  const rangeWidth = rangeInline
    ? Math.min(RANGE_MAX_WIDTH, Math.floor((contentWidth - 2) / 2))
    : Math.min(RANGE_MAX_WIDTH, contentWidth);
  const rangeMarkerColor = quote ? priceColor(quote.change) : colors.textDim;

  const stats: StatField[] = [];

  if (quote?.volume != null) {
    stats.push({ label: "Volume", value: formatCompact(quote.volume) });
  }
  if (quote?.marketCap) {
    stats.push({ label: "Market Cap", value: formatCompactCurrency(toBase(quote.marketCap, quoteCurrency), baseCurrency) });
  }
  if (fundamentals?.sharesOutstanding) {
    stats.push({ label: "Shares Out", value: formatCompact(fundamentals.sharesOutstanding) });
  }
  if (fundamentals?.trailingPE) {
    stats.push({ label: "P/E (TTM)", value: formatNumber(fundamentals.trailingPE, 1) });
  }
  if (fundamentals?.forwardPE) {
    stats.push({ label: "Fwd P/E", value: formatNumber(fundamentals.forwardPE, 1) });
  }
  if (fundamentals?.eps) {
    stats.push({ label: "EPS", value: formatCurrency(fundamentals.eps, quoteCurrency) });
  }
  if (fundamentals?.pegRatio) {
    stats.push({ label: "PEG", value: formatNumber(fundamentals.pegRatio, 2) });
  }
  if (fundamentals?.dividendYield != null) {
    stats.push({ label: "Div Yield", value: formatPercent(fundamentals.dividendYield) });
  }
  if (fundamentals?.revenue) {
    stats.push({ label: "Revenue", value: formatCompact(fundamentals.revenue) });
  }
  if (fundamentals?.netIncome) {
    stats.push({ label: "Net Income", value: formatCompact(fundamentals.netIncome) });
  }
  if (fundamentals?.freeCashFlow) {
    stats.push({ label: "FCF", value: formatCompact(fundamentals.freeCashFlow) });
  }
  if (fundamentals?.operatingMargin != null) {
    stats.push({ label: "Op Margin", value: formatPercent(fundamentals.operatingMargin) });
  }
  if (fundamentals?.profitMargin != null) {
    stats.push({ label: "Profit Marg", value: formatPercent(fundamentals.profitMargin) });
  }
  if (fundamentals?.revenueGrowth != null) {
    stats.push({
      label: "Rev Growth",
      value: formatPercent(fundamentals.revenueGrowth),
      valueColor: priceColor(fundamentals.revenueGrowth),
    });
  }
  if (fundamentals?.return1Y != null) {
    stats.push({
      label: "1Y Return",
      value: formatPercent(fundamentals.return1Y),
      valueColor: priceColor(fundamentals.return1Y),
    });
  }
  if (fundamentals?.return3Y != null) {
    stats.push({
      label: "3Y Return",
      value: formatPercent(fundamentals.return3Y),
      valueColor: priceColor(fundamentals.return3Y),
    });
  }
  if (fundamentals?.enterpriseValue) {
    stats.push({ label: "EV", value: formatCompact(fundamentals.enterpriseValue) });
  }

  const positionRows: PositionTableRow[] = ticker.metadata.positions.map((position) => {
    const positionCurrency = position.currency || quoteCurrency;
    const costBasis = position.shares * position.avgCost * (position.multiplier || 1);
    const costBasisBase = toBase(costBasis, positionCurrency);
    const fallbackMarkPrice = position.markPrice ?? quote?.price;
    const fallbackMarkCurrency = position.markPrice != null ? positionCurrency : quoteCurrency;
    const marketValueBase = position.marketValue != null
      ? toBase(position.marketValue, positionCurrency)
      : fallbackMarkPrice != null
        ? toBase(Math.abs(position.shares) * fallbackMarkPrice * (position.multiplier || 1), fallbackMarkCurrency)
        : null;
    const pnlValue = position.unrealizedPnl != null
      ? toBase(position.unrealizedPnl, positionCurrency)
      : marketValueBase != null
        ? marketValueBase - costBasisBase
        : null;
    const returnPercent = pnlValue != null && costBasisBase !== 0
      ? formatPercentRaw((pnlValue / Math.abs(costBasisBase)) * 100)
      : "—";
    const unit = position.multiplier && position.multiplier > 1 ? " ct" : " sh";

    return {
      account: compactPositionAccount(position),
      qty: `${formatMarketQuantity(position.shares, { assetCategory: ticker.metadata.assetCategory, multiplier: position.multiplier })}${unit}`,
      avg: formatMarketCostWithCurrency(position.avgCost, positionCurrency, {
        assetCategory: ticker.metadata.assetCategory,
        multiplier: position.multiplier,
      }),
      mark: fallbackMarkPrice != null
        ? formatMarketPriceWithCurrency(fallbackMarkPrice, fallbackMarkCurrency, {
            assetCategory: ticker.metadata.assetCategory,
            multiplier: position.multiplier,
          })
        : "—",
      cost: formatCurrency(costBasisBase, baseCurrency),
      value: marketValueBase != null ? formatCurrency(marketValueBase, baseCurrency) : "—",
      pnl: pnlValue != null ? `${pnlValue >= 0 ? "+" : ""}${formatCurrency(pnlValue, baseCurrency)}` : "—",
      ret: returnPercent,
      pnlValue,
    };
  });

  return (
    <ScrollBox flexGrow={1} flexBasis={0} scrollY focusable={false}>
      <Box flexDirection="column" paddingX={1} paddingBottom={1} gap={1}>
        <Box flexDirection={quoteBookInline ? "row" : "column"} gap={quoteBookInline ? 2 : 0} width={contentWidth}>
          <Box flexDirection="column" width={quoteSummaryWidth}>
            <Box flexDirection="row">
              <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {ticker.metadata.ticker}
              </Text>
              {ticker.metadata.name && ticker.metadata.name !== ticker.metadata.ticker && (
                <Text fg={colors.textDim}>
                  {" "}- {ticker.metadata.name || quote?.name || ""}
                </Text>
              )}
              {listingVenue && (
                <Text fg={colors.textDim}>{" "}({listingVenue})</Text>
              )}
              {quote?.marketState && (
                <Text fg={marketStateColor(quote.marketState)}>
                  {" "}{marketStateLabel(quote.marketState)}
                </Text>
              )}
            </Box>

            {quote && (
              <Box flexDirection="row" gap={2}>
                <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                  {formatMarketPriceWithCurrency(quote.price, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </Text>
                <Text fg={priceColor(quote.change)}>
                  {formatSignedMarketPrice(quote.change, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.changePercent)})
                </Text>
              </Box>
            )}
            {quote && (quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null && (
              <Box flexDirection="row" gap={2}>
                <Text fg={colors.textDim}>Pre-Market:</Text>
                <Text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {formatMarketPriceWithCurrency(quote.preMarketPrice, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </Text>
                <Text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {formatSignedMarketPrice(quote.preMarketChange ?? 0, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.preMarketChangePercent ?? 0)})
                </Text>
              </Box>
            )}
            {quote && (quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null && (
              <Box flexDirection="row" gap={2}>
                <Text fg={colors.textDim}>After-Hours:</Text>
                <Text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {formatMarketPriceWithCurrency(quote.postMarketPrice, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </Text>
                <Text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {formatSignedMarketPrice(quote.postMarketChange ?? 0, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.postMarketChangePercent ?? 0)})
                </Text>
              </Box>
            )}
            {metadataParts.length > 0 && (
              <Text fg={colors.textDim}>{metadataParts.join(" | ")}</Text>
            )}
          </Box>

          {quote && hasBidAsk && (
            <QuoteBook quote={quote} assetCategory={ticker.metadata.assetCategory} width={quoteBookWidth} />
          )}
        </Box>

        {(hasDayRange || hasYearRange) && quote && (
          <Box flexDirection={rangeInline ? "row" : "column"} gap={rangeInline ? 2 : 0} width={contentWidth}>
            {hasDayRange && (
              <CompactRangeBar
                current={quote.price}
                low={quote.low!}
                high={quote.high!}
                label="Day Range"
                width={rangeWidth}
                currency={quoteCurrency}
                assetCategory={ticker.metadata.assetCategory}
                markerColor={rangeMarkerColor}
              />
            )}
            {hasYearRange && (
              <CompactRangeBar
                current={quote.price}
                low={quote.low52w!}
                high={quote.high52w!}
                label="52W Range"
                width={rangeWidth}
                currency={quoteCurrency}
                assetCategory={ticker.metadata.assetCategory}
                markerColor={rangeMarkerColor}
              />
            )}
          </Box>
        )}

        {hasHistory && (
          <ResolvedStockChart
            width={chartWidth}
            height={10}
            focused={false}
            compact
            symbol={symbol}
            ticker={ticker}
            financials={financials}
          />
        )}

        {stats.length > 0 && (
          <Box flexDirection="column">
            <SectionHeader title="Fundamentals" />
            <StatGrid fields={stats} width={contentWidth} />
          </Box>
        )}

        {positionRows.length > 0 && (
          <Box flexDirection="column">
            <SectionHeader title="Positions" />
            <PositionTable rows={positionRows} width={contentWidth} />
          </Box>
        )}

        {/* Sector / Industry / Type */}
        {(sector || industry || ticker.metadata.assetCategory) && (
          <Box flexDirection="row" height={1} gap={3}>
            {ticker.metadata.assetCategory && (
              <Box flexDirection="row">
                <Text fg={colors.textDim}>Type: </Text>
                <Text fg={colors.text}>{ticker.metadata.assetCategory}</Text>
              </Box>
            )}
            {sector && (
              <Box flexDirection="row">
                <Text fg={colors.textDim}>Sector: </Text>
                <Text fg={colors.text}>{sector}</Text>
              </Box>
            )}
            {industry && (
              <Box flexDirection="row">
                <Text fg={colors.textDim}>Industry: </Text>
                <Text fg={colors.text}>{industry}</Text>
              </Box>
            )}
          </Box>
        )}

        {/* ISIN */}
        {ticker.metadata.isin && (
          <Box flexDirection="row" height={1}>
            <Text fg={colors.textDim}>ISIN: </Text>
            <Text fg={colors.text}>{ticker.metadata.isin}</Text>
          </Box>
        )}

        {/* Description — last, collapsed */}
        {description && (
          <Box flexDirection="column" width={contentWidth}>
            <SectionHeader title="Description" />
            <Text fg={colors.text} width={contentWidth} wrapMode="word" wrapText>{description}</Text>
          </Box>
        )}
      </Box>
    </ScrollBox>
  );
}
