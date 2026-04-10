import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useFxRatesMap } from "../../../market-data/hooks";
import { useAppSelector } from "../../../state/app-context";
import { colors, priceColor, blendHex } from "../../../theme/colors";
import {
  convertCurrency,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPercentRaw,
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
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";

// ─── Visual range bar ────────────────────────────────────────────────────────

function RangeBar({
  current,
  low,
  high,
  label,
  barWidth,
  currency,
  assetCategory,
}: {
  current: number;
  low: number;
  high: number;
  label: string;
  barWidth: number;
  currency: string;
  assetCategory?: string;
}) {
  const range = high - low;
  if (range <= 0) return null;
  const position = Math.max(0, Math.min(1, (current - low) / range));
  const filledWidth = Math.max(1, Math.round(position * barWidth));
  const emptyWidth = Math.max(0, barWidth - filledWidth);
  const pctLabel = `${Math.round(position * 100)}%`;
  const fillColor = blendHex(colors.negative, colors.positive, position);
  const trackChar = "─";
  const fillChar = "━";

  return (
    <box flexDirection="column">
      <box flexDirection="row" height={1}>
        <box width={12}>
          <text fg={colors.textDim}>{label}</text>
        </box>
        <text fg={colors.textDim}>
          {formatMarketPriceWithCurrency(low, currency, { assetCategory })}
        </text>
        <box marginLeft={1} marginRight={1} flexDirection="row">
          <text fg={fillColor}>{fillChar.repeat(filledWidth)}</text>
          <text fg={colors.border}>{trackChar.repeat(emptyWidth)}</text>
        </box>
        <text fg={colors.textDim}>
          {formatMarketPriceWithCurrency(high, currency, { assetCategory })}
        </text>
        <box marginLeft={1}>
          <text fg={fillColor}>{pctLabel}</text>
        </box>
      </box>
    </box>
  );
}

// ─── Volume bar ──────────────────────────────────────────────────────────────

function VolumeBar({ volume, avgVolume, barWidth }: { volume: number; avgVolume: number; barWidth: number }) {
  if (!volume || !avgVolume) return null;
  const ratio = volume / avgVolume;
  const maxRatio = Math.max(ratio, 1);
  const volWidth = Math.max(1, Math.round((Math.min(ratio, maxRatio) / maxRatio) * barWidth));
  const avgWidth = Math.max(1, Math.round((1 / maxRatio) * barWidth));
  const ratioColor = ratio >= 2 ? colors.textBright : ratio >= 1 ? colors.text : colors.textDim;

  return (
    <box flexDirection="row" height={1}>
      <box width={12}>
        <text fg={colors.textDim}>Volume</text>
      </box>
      <text fg={colors.textDim}>{formatCompact(volume)}</text>
      <box marginLeft={1} marginRight={1} flexDirection="row">
        <text fg={ratioColor}>{"━".repeat(volWidth)}</text>
        <text fg={colors.border}>{"─".repeat(Math.max(0, barWidth - volWidth))}</text>
      </box>
      <text fg={colors.textDim}>avg {formatCompact(avgVolume)}</text>
      <box marginLeft={1}>
        <text fg={ratioColor}>{ratio.toFixed(1)}x</text>
      </box>
    </box>
  );
}

// ─── Two-column stat grid ────────────────────────────────────────────────────

interface StatField {
  label: string;
  value: string;
  valueColor?: string;
}

function StatGrid({ fields, width }: { fields: StatField[]; width: number }) {
  const colWidth = Math.floor(width / 2);
  const rows: Array<[StatField | null, StatField | null]> = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push([fields[i] ?? null, fields[i + 1] ?? null]);
  }

  return (
    <box flexDirection="column">
      {rows.map((row, i) => (
        <box key={i} flexDirection="row" height={1}>
          {row.map((field, j) => {
            if (!field) return <box key={j} width={colWidth} />;
            return (
              <box key={j} width={colWidth} flexDirection="row">
                <box width={14}>
                  <text fg={colors.textDim}>{field.label}</text>
                </box>
                <text fg={field.valueColor ?? colors.text}>{field.value}</text>
              </box>
            );
          })}
        </box>
      ))}
    </box>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <box height={1}>
      <text attributes={TextAttributes.BOLD} fg={colors.textBright}>{title}</text>
    </box>
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
  const { width: termWidth } = useTerminalDimensions();

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
  const metadataParts = [
    priceSource ? `Price source: ${priceSource}` : "",
    sessionSource ? `Session source: ${sessionSource}` : "",
    routingVenue && routingVenue !== listingVenue ? `Route: ${routingVenue}` : "",
  ].filter((part) => part.length > 0);

  const contentWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const chartWidth = contentWidth;
  const barWidth = Math.max(10, contentWidth - 50);
  const hasHistory = (financials?.priceHistory?.length ?? 0) > 2;

  // Build the two-column stat grid
  const stats: StatField[] = [];

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

  // Bid/ask
  const hasBidAsk = quote?.bid != null || quote?.ask != null;

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={1} paddingBottom={1} gap={1}>
        {/* Ticker header */}
        <box flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
            {ticker.metadata.ticker}
          </text>
          {ticker.metadata.name && ticker.metadata.name !== ticker.metadata.ticker && (
            <text fg={colors.textDim}>
              {" "}- {ticker.metadata.name || quote?.name || ""}
            </text>
          )}
          {listingVenue && (
            <text fg={colors.textDim}>{" "}({listingVenue})</text>
          )}
          {quote?.marketState && (
            <text fg={marketStateColor(quote.marketState)}>
              {" "}{marketStateLabel(quote.marketState)}
            </text>
          )}
        </box>

        {/* Price block */}
        {quote && (
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={2}>
              <text attributes={TextAttributes.BOLD} fg={priceColor(quote.change)}>
                {formatMarketPriceWithCurrency(quote.price, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
              </text>
              <text fg={priceColor(quote.change)}>
                {formatSignedMarketPrice(quote.change, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.changePercent)})
              </text>
            </box>
            {(quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>Pre-Market:</text>
                <text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {formatMarketPriceWithCurrency(quote.preMarketPrice, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </text>
                <text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {formatSignedMarketPrice(quote.preMarketChange ?? 0, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.preMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
            {(quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>After-Hours:</text>
                <text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {formatMarketPriceWithCurrency(quote.postMarketPrice, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </text>
                <text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {formatSignedMarketPrice(quote.postMarketChange ?? 0, { assetCategory: ticker.metadata.assetCategory })} ({formatPercentRaw(quote.postMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
            {metadataParts.length > 0 && (
              <text fg={colors.textDim}>{metadataParts.join(" | ")}</text>
            )}
          </box>
        )}

        {/* Range bars */}
        {quote?.low != null && quote?.high != null && quote.high > quote.low && (
          <RangeBar
            current={quote.price}
            low={quote.low}
            high={quote.high}
            label="Day Range"
            barWidth={barWidth}
            currency={quoteCurrency}
            assetCategory={ticker.metadata.assetCategory}
          />
        )}
        {quote?.low52w != null && quote?.high52w != null && quote.high52w > quote.low52w && (
          <RangeBar
            current={quote.price}
            low={quote.low52w}
            high={quote.high52w}
            label="52W Range"
            barWidth={barWidth}
            currency={quoteCurrency}
            assetCategory={ticker.metadata.assetCategory}
          />
        )}
        {quote?.volume != null && fundamentals?.sharesOutstanding && (
          <VolumeBar
            volume={quote.volume}
            avgVolume={Math.round((fundamentals.sharesOutstanding * 0.01) || quote.volume)}
            barWidth={barWidth}
          />
        )}

        {/* Chart */}
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

        {/* Bid/Ask */}
        {hasBidAsk && quote && (
          <box flexDirection="row" height={1} gap={3}>
            <box flexDirection="row">
              <text fg={colors.textDim}>Bid: </text>
              <text fg={colors.text}>
                {quote.bid != null ? formatMarketPriceWithCurrency(quote.bid, quote.currency, { assetCategory: ticker.metadata.assetCategory }) : "—"}
                {quote.bidSize != null ? ` ×${quote.bidSize}` : ""}
              </text>
            </box>
            <box flexDirection="row">
              <text fg={colors.textDim}>Ask: </text>
              <text fg={colors.text}>
                {quote.ask != null ? formatMarketPriceWithCurrency(quote.ask, quote.currency, { assetCategory: ticker.metadata.assetCategory }) : "—"}
                {quote.askSize != null ? ` ×${quote.askSize}` : ""}
              </text>
            </box>
            {quote.bid != null && quote.ask != null && (
              <box flexDirection="row">
                <text fg={colors.textDim}>Spread: </text>
                <text fg={colors.text}>
                  {formatMarketPriceWithCurrency(quote.ask - quote.bid, quote.currency, { assetCategory: ticker.metadata.assetCategory })}
                </text>
              </box>
            )}
          </box>
        )}

        {/* Two-column stats grid */}
        {stats.length > 0 && (
          <box flexDirection="column">
            <SectionHeader title="Fundamentals" />
            <StatGrid fields={stats} width={contentWidth} />
          </box>
        )}

        {/* Positions */}
        {ticker.metadata.positions.length > 0 && (
          <box flexDirection="column">
            <SectionHeader title="Positions" />
            {ticker.metadata.positions.map((position, index) => {
              const costBasis = position.shares * position.avgCost * (position.multiplier || 1);
              const positionCurrency = position.currency || quoteCurrency;
              const costBasisBase = toBase(costBasis, positionCurrency);
              const marketValueBase = position.marketValue != null
                ? toBase(position.marketValue, positionCurrency)
                : position.markPrice != null
                  ? toBase(Math.abs(position.shares) * position.markPrice * (position.multiplier || 1), positionCurrency)
                  : quote
                    ? toBase(Math.abs(position.shares) * quote.price * (position.multiplier || 1), quoteCurrency)
                    : null;
              const pnlValue = position.unrealizedPnl != null
                ? toBase(position.unrealizedPnl, positionCurrency)
                : marketValueBase != null
                  ? marketValueBase - costBasisBase
                  : null;
              const pnlText = pnlValue != null
                ? `  P&L: ${pnlValue >= 0 ? "+" : ""}${formatCurrency(pnlValue, baseCurrency)}`
                : "";

              return (
                <box key={index} flexDirection="column">
                  <box flexDirection="row" height={1}>
                    <text fg={colors.textDim}>{position.portfolio}</text>
                    <text fg={colors.textMuted}>{" via "}{position.broker}</text>
                    {position.side === "short" && <text fg={colors.negative}>{" SHORT"}</text>}
                  </box>
                  <box flexDirection="row" height={1}>
                    <text fg={colors.text}>
                      {formatMarketQuantity(position.shares, { assetCategory: ticker.metadata.assetCategory, multiplier: position.multiplier })} {position.multiplier && position.multiplier > 1 ? "contracts" : "shares"} @ {formatMarketCostWithCurrency(position.avgCost, positionCurrency, { assetCategory: ticker.metadata.assetCategory, multiplier: position.multiplier })}
                      {" = "}{formatCurrency(costBasisBase, baseCurrency)}
                    </text>
                    {pnlText && (
                      <text fg={priceColor(pnlValue ?? 0)}>{pnlText}</text>
                    )}
                  </box>
                  {position.markPrice != null && (
                    <box flexDirection="row" height={1}>
                      <text fg={colors.textDim}>Mark: {formatMarketPriceWithCurrency(position.markPrice, positionCurrency, { assetCategory: ticker.metadata.assetCategory, multiplier: position.multiplier })}</text>
                      {marketValueBase != null && (
                        <text fg={colors.textDim}>{" "}Mkt Value: {formatCurrency(marketValueBase, baseCurrency)}</text>
                      )}
                    </box>
                  )}
                </box>
              );
            })}
          </box>
        )}

        {/* Sector / Industry / Type */}
        {(sector || industry || ticker.metadata.assetCategory) && (
          <box flexDirection="row" height={1} gap={3}>
            {ticker.metadata.assetCategory && (
              <box flexDirection="row">
                <text fg={colors.textDim}>Type: </text>
                <text fg={colors.text}>{ticker.metadata.assetCategory}</text>
              </box>
            )}
            {sector && (
              <box flexDirection="row">
                <text fg={colors.textDim}>Sector: </text>
                <text fg={colors.text}>{sector}</text>
              </box>
            )}
            {industry && (
              <box flexDirection="row">
                <text fg={colors.textDim}>Industry: </text>
                <text fg={colors.text}>{industry}</text>
              </box>
            )}
          </box>
        )}

        {/* ISIN */}
        {ticker.metadata.isin && (
          <box flexDirection="row" height={1}>
            <text fg={colors.textDim}>ISIN: </text>
            <text fg={colors.text}>{ticker.metadata.isin}</text>
          </box>
        )}

        {/* Description — last, collapsed */}
        {description && (
          <box flexDirection="column">
            <SectionHeader title="Description" />
            <text fg={colors.text}>{description}</text>
          </box>
        )}
      </box>
    </scrollbox>
  );
}
