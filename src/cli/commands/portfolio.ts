import { formatCompact, formatCurrency } from "../../utils/format";
import {
  cliStyles,
  colorBySign,
  renderSection,
  renderStat,
  renderTable,
} from "../../utils/cli-output";
import { exchangeShortName } from "../../utils/market-status";
import type { AppConfig } from "../../types/config";
import type { TickerRecord } from "../../types/ticker";
import { createBaseConverter, initConfigData, initMarketData } from "../context";
import { closeAndFail } from "../errors";
import {
  countCollectionTickers,
  formatSignedCurrency,
  formatSignedPercentRaw,
} from "../helpers";

function renderCollectionOverview(config: AppConfig, tickers: TickerRecord[]): string {
  const blocks: string[] = [];

  blocks.push(renderSection("Portfolios"));
  if (config.portfolios.length === 0) {
    blocks.push(cliStyles.muted("No portfolios configured."));
  } else {
    blocks.push(renderTable(
      [
        { header: "Portfolio" },
        { header: "Currency" },
        { header: "Tickers", align: "right" },
      ],
      config.portfolios.map((portfolio) => [
        portfolio.name,
        portfolio.currency,
        String(countCollectionTickers(tickers, "portfolios", portfolio.id)),
      ]),
    ));
  }

  blocks.push("");
  blocks.push(renderSection("Watchlists"));
  if (config.watchlists.length === 0) {
    blocks.push(cliStyles.muted("No watchlists configured."));
  } else {
    blocks.push(renderTable(
      [
        { header: "Watchlist" },
        { header: "Tickers", align: "right" },
      ],
      config.watchlists.map((watchlist) => [
        watchlist.name,
        String(countCollectionTickers(tickers, "watchlists", watchlist.id)),
      ]),
    ));
  }

  return blocks.join("\n");
}

export async function showCollection(name: string) {
  const { config, store, dataProvider, persistence } = await initMarketData();
  const tickers = (await store.loadAllTickers()).sort((left, right) =>
    left.metadata.ticker.localeCompare(right.metadata.ticker)
  );
  const baseCurrency = config.baseCurrency;
  const toBase = createBaseConverter(dataProvider, baseCurrency);

  const normalized = name.trim().toLowerCase();
  const matchedPortfolio = config.portfolios.find((portfolio) =>
    portfolio.id.toLowerCase() === normalized || portfolio.name.toLowerCase() === normalized
  );
  const matchedWatchlist = config.watchlists.find((watchlist) =>
    watchlist.id.toLowerCase() === normalized || watchlist.name.toLowerCase() === normalized
  );

  if (!matchedPortfolio && !matchedWatchlist) {
    closeAndFail(
      persistence,
      `Collection "${name}" was not found.`,
      `Available: ${[...config.portfolios.map((portfolio) => portfolio.name), ...config.watchlists.map((watchlist) => watchlist.name)].join(", ")}`,
    );
  }

  const isPortfolio = !!matchedPortfolio;
  const id = matchedPortfolio?.id ?? matchedWatchlist!.id;
  const displayName = matchedPortfolio?.name ?? matchedWatchlist!.name;
  const currency = matchedPortfolio?.currency ?? baseCurrency;
  const filtered = tickers.filter((ticker) =>
    isPortfolio ? ticker.metadata.portfolios.includes(id) : ticker.metadata.watchlists.includes(id)
  );

  if (filtered.length === 0) {
    console.log(cliStyles.bold(displayName));
    console.log(cliStyles.muted("No tickers in this collection."));
    persistence.close();
    return;
  }

  const quotes = new Map<string, Awaited<ReturnType<typeof dataProvider.getQuote>>>();
  await Promise.all(
    filtered.map(async (ticker) => {
      try {
        const quote = await dataProvider.getQuote(ticker.metadata.ticker, ticker.metadata.exchange);
        quotes.set(ticker.metadata.ticker, quote);
      } catch {
        // Ignore partial quote failures so the rest of the table still renders.
      }
    }),
  );

  console.log(cliStyles.bold(displayName + (isPortfolio ? ` (${currency})` : "")));
  console.log(cliStyles.muted(`${filtered.length} ticker${filtered.length === 1 ? "" : "s"}`));
  console.log("");

  if (isPortfolio) {
    let totalPnl = 0;
    const rows: string[][] = [];

    for (const ticker of filtered) {
      const quote = quotes.get(ticker.metadata.ticker);
      const positions = ticker.metadata.positions.filter((position) => position.portfolio === id);
      const priceText = quote ? colorBySign(formatCurrency(quote.price, quote.currency), quote.change) : "—";
      const changeText = quote ? colorBySign(formatSignedPercentRaw(quote.changePercent), quote.change) : "—";

      if (positions.length === 0) {
        rows.push([ticker.metadata.ticker, priceText, changeText, "—", "—", "—"]);
        continue;
      }

      for (const position of positions) {
        const multiplier = position.multiplier ?? 1;
        const quoteCurrency = quote?.currency ?? ticker.metadata.currency ?? baseCurrency;
        const positionCurrency = position.currency ?? quoteCurrency;
        const currentValueBase = quote
          ? await toBase(Math.abs(position.shares) * quote.price * multiplier, quoteCurrency)
          : null;
        const costBasisBase = await toBase(position.shares * position.avgCost * multiplier, positionCurrency);
        const pnl = currentValueBase != null ? currentValueBase - costBasisBase : null;
        if (pnl != null) totalPnl += pnl;

        rows.push([
          ticker.metadata.ticker,
          priceText,
          changeText,
          String(position.shares),
          formatCurrency(position.avgCost, positionCurrency),
          pnl == null ? "—" : colorBySign(formatSignedCurrency(pnl, baseCurrency), pnl),
        ]);
      }
    }

    console.log(renderTable(
      [
        { header: "Ticker" },
        { header: "Last", align: "right" },
        { header: "Chg", align: "right" },
        { header: "Shares", align: "right" },
        { header: "Avg Cost", align: "right" },
        { header: "P&L", align: "right" },
      ],
      rows,
    ));
    console.log("");
    console.log(renderStat("Total P&L", colorBySign(formatSignedCurrency(totalPnl, baseCurrency), totalPnl)));
  } else {
    const rows: string[][] = [];
    for (const ticker of filtered) {
      const quote = quotes.get(ticker.metadata.ticker);
      const priceText = quote ? colorBySign(formatCurrency(quote.price, quote.currency), quote.change) : "—";
      const changeText = quote ? colorBySign(formatSignedPercentRaw(quote.changePercent), quote.change) : "—";
      const marketCapText = quote?.marketCap != null
        ? `${formatCompact(await toBase(quote.marketCap, quote.currency || ticker.metadata.currency || baseCurrency))} ${baseCurrency}`
        : "—";

      rows.push([
        ticker.metadata.ticker,
        exchangeShortName(quote?.exchangeName, quote?.fullExchangeName) || ticker.metadata.exchange || "—",
        priceText,
        changeText,
        marketCapText,
      ]);
    }

    console.log(renderTable(
      [
        { header: "Ticker" },
        { header: "Exchange" },
        { header: "Last", align: "right" },
        { header: "Chg", align: "right" },
        { header: "Mkt Cap", align: "right" },
      ],
      rows,
    ));
  }

  persistence.close();
}

export async function portfolio(name?: string) {
  if (!name) {
    const { config, store, persistence } = await initConfigData();
    const tickers = await store.loadAllTickers();
    console.log(renderCollectionOverview(config, tickers));
    persistence.close();
    return;
  }

  await showCollection(name);
}
