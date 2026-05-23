import { Box, ScrollBox, Text, useUiCapabilities } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { useViewport } from "../../../react/input";
import { useFxRatesMap } from "../../../market-data/hooks";
import { useAppSelector } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import { convertCurrency, formatPercentRaw } from "../../../utils/format";
import { formatMarketPriceWithCurrency, formatSignedMarketPrice } from "../../../utils/market-format";
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
import {
  CompactRangeBar,
  PositionTable,
  QuoteBook,
  SectionHeader,
  StatGrid,
} from "./overview/components";
import { buildOverviewStats, buildPositionRows } from "./overview/model";

export function OverviewTab({
  width,
  ticker,
  financials,
}: {
  width?: number;
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
}) {
  const baseCurrency = useAppSelector((state) => state.config.baseCurrency);
  const exchangeRatesState = useAppSelector((state) => state.exchangeRates);
  const { width: termWidth } = useViewport();
  const { fractionalViewport = false } = useUiCapabilities();

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

  const contentWidth = Math.max((width || Math.floor(termWidth * 0.5)) - (fractionalViewport ? 2 : 4), 20);
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
    ? Math.floor((contentWidth - 2) / 2)
    : contentWidth;
  const rangeMarkerColor = quote ? priceColor(quote.change) : colors.textDim;
  const stats = buildOverviewStats({
    quote,
    fundamentals,
    quoteCurrency,
    baseCurrency,
    toBase,
  });
  const positionRows = buildPositionRows({
    ticker,
    quote,
    quoteCurrency,
    baseCurrency,
    toBase,
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
