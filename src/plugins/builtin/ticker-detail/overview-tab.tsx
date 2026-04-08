import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useFxRatesMap } from "../../../market-data/hooks";
import { useAppSelector } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import {
  convertCurrency,
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPercentRaw,
} from "../../../utils/format";
import {
  exchangeShortName,
  marketStateColor,
  marketStateLabel,
  quoteSourceLabel,
} from "../../../utils/market-status";
import { selectEffectiveExchangeRates } from "../../../utils/exchange-rate-map";
import { EmptyState, FieldRow } from "../../../components";
import { ResolvedStockChart } from "../../../components/chart/stock-chart";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";

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

  const chartWidth = Math.max((width || Math.floor(termWidth * 0.5)) - 4, 20);
  const hasHistory = (financials?.priceHistory?.length ?? 0) > 2;

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={1} paddingBottom={1} gap={1}>
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
            <text fg={colors.textDim}>
              {" "}({listingVenue})
            </text>
          )}
          {quote?.marketState && (
            <text fg={marketStateColor(quote.marketState)}>
              {" "}{marketStateLabel(quote.marketState)}
            </text>
          )}
        </box>

        {quote && (
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={2}>
              <text attributes={TextAttributes.BOLD} fg={priceColor(quote.change)}>
                {formatCurrency(quote.price, quote.currency)}
              </text>
              <text fg={priceColor(quote.change)}>
                {quote.change >= 0 ? "+" : ""}
                {quote.change.toFixed(2)} ({formatPercentRaw(quote.changePercent)})
              </text>
            </box>
            {(quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>Pre-Market:</text>
                <text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {formatCurrency(quote.preMarketPrice, quote.currency)}
                </text>
                <text fg={priceColor(quote.preMarketChange ?? 0)}>
                  {(quote.preMarketChange ?? 0) >= 0 ? "+" : ""}
                  {(quote.preMarketChange ?? 0).toFixed(2)} ({formatPercentRaw(quote.preMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
            {(quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null && (
              <box flexDirection="row" gap={2}>
                <text fg={colors.textDim}>After-Hours:</text>
                <text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {formatCurrency(quote.postMarketPrice, quote.currency)}
                </text>
                <text fg={priceColor(quote.postMarketChange ?? 0)}>
                  {(quote.postMarketChange ?? 0) >= 0 ? "+" : ""}
                  {(quote.postMarketChange ?? 0).toFixed(2)} ({formatPercentRaw(quote.postMarketChangePercent ?? 0)})
                </text>
              </box>
            )}
            {metadataParts.length > 0 && (
              <text fg={colors.textDim}>{metadataParts.join(" | ")}</text>
            )}
          </box>
        )}

        {hasHistory && (
          <ResolvedStockChart
            width={chartWidth}
            height={8}
            focused={false}
            compact
            symbol={symbol}
            ticker={ticker}
            financials={financials}
          />
        )}

        <box flexDirection="column">
          <FieldRow
            label="Market Cap"
            value={quote?.marketCap ? formatCompactCurrency(toBase(quote.marketCap, quoteCurrency), baseCurrency) : "—"}
          />
          <FieldRow label="P/E (TTM)" value={fundamentals?.trailingPE ? formatNumber(fundamentals.trailingPE, 1) : "—"} />
          <FieldRow label="Forward P/E" value={fundamentals?.forwardPE ? formatNumber(fundamentals.forwardPE, 1) : "—"} />
          <FieldRow label="PEG Ratio" value={fundamentals?.pegRatio ? formatNumber(fundamentals.pegRatio, 2) : "—"} />
          <FieldRow label="EPS" value={fundamentals?.eps ? formatCurrency(fundamentals.eps, quoteCurrency) : "—"} />
          <FieldRow label="Div Yield" value={fundamentals?.dividendYield != null ? formatPercent(fundamentals.dividendYield) : "—"} />
          <FieldRow label="Revenue" value={fundamentals?.revenue ? formatCompact(fundamentals.revenue) : "—"} />
          <FieldRow label="Net Income" value={fundamentals?.netIncome ? formatCompact(fundamentals.netIncome) : "—"} />
          <FieldRow label="FCF" value={fundamentals?.freeCashFlow ? formatCompact(fundamentals.freeCashFlow) : "—"} />
          <FieldRow label="Op. Margin" value={fundamentals?.operatingMargin != null ? formatPercent(fundamentals.operatingMargin) : "—"} />
          <FieldRow label="Profit Margin" value={fundamentals?.profitMargin != null ? formatPercent(fundamentals.profitMargin) : "—"} />
          {(quote?.bid != null || quote?.ask != null) && (
            <>
              <FieldRow label="Bid" value={quote?.bid != null ? formatCurrency(quote.bid, quote.currency) : "—"} />
              <FieldRow label="Ask" value={quote?.ask != null ? formatCurrency(quote.ask, quote.currency) : "—"} />
              <FieldRow
                label="Spread"
                value={quote?.bid != null && quote?.ask != null ? formatCurrency(quote.ask - quote.bid, quote.currency) : "—"}
              />
            </>
          )}
          <FieldRow
            label="52W Range"
            value={quote?.low52w && quote?.high52w ? `${formatCurrency(quote.low52w, quoteCurrency)} - ${formatCurrency(quote.high52w, quoteCurrency)}` : "—"}
          />
          <FieldRow
            label="1Y Return"
            value={fundamentals?.return1Y != null ? formatPercent(fundamentals.return1Y) : "—"}
            valueColor={fundamentals?.return1Y != null ? priceColor(fundamentals.return1Y) : undefined}
          />
          <FieldRow
            label="3Y Return"
            value={fundamentals?.return3Y != null ? formatPercent(fundamentals.return3Y) : "—"}
            valueColor={fundamentals?.return3Y != null ? priceColor(fundamentals.return3Y) : undefined}
          />
        </box>

        {description && (
          <box flexDirection="column" paddingTop={1}>
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Description</text>
            </box>
            <text fg={colors.text}>{description}</text>
          </box>
        )}

        {(sector || industry || ticker.metadata.assetCategory || ticker.metadata.isin) && (
          <box flexDirection="column">
            {ticker.metadata.assetCategory && (
              <FieldRow label="Type" value={ticker.metadata.assetCategory} />
            )}
            {sector && (
              <FieldRow label="Sector" value={sector} />
            )}
            {industry && (
              <FieldRow label="Industry" value={industry} />
            )}
            {ticker.metadata.isin && (
              <FieldRow label="ISIN" value={ticker.metadata.isin} />
            )}
          </box>
        )}

        {ticker.metadata.positions.length > 0 && (
          <box flexDirection="column">
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Positions</text>
            </box>
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
                      {position.shares} {position.multiplier && position.multiplier > 1 ? "contracts" : "shares"} @ {formatCurrency(position.avgCost, positionCurrency)}
                      {" = "}{formatCurrency(costBasisBase, baseCurrency)}
                    </text>
                    {pnlText && (
                      <text fg={priceColor(pnlValue ?? 0)}>{pnlText}</text>
                    )}
                  </box>
                  {position.markPrice != null && (
                    <box flexDirection="row" height={1}>
                      <text fg={colors.textDim}>Mark: {formatCurrency(position.markPrice, positionCurrency)}</text>
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
      </box>
    </scrollbox>
  );
}
