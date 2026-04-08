import { saveConfig } from "../../../../data/config-store";
import { createBaseConverter } from "../../../../cli/base-converter";
import {
  countCollectionTickers,
  findWatchlist,
  formatSignedCurrency,
  formatSignedPercentRaw,
  slugifyName,
} from "../../../../cli/helpers";
import { resolveTickerForCli } from "../../../../cli/ticker-resolution";
import {
  cliStyles,
  colorBySign,
  renderSection,
  renderStat,
  renderTable,
} from "../../../../utils/cli-output";
import { exchangeShortName } from "../../../../utils/market-status";
import { formatCompact, formatCurrency } from "../../../../utils/format";
import type { AppConfig } from "../../../../types/config";
import type { CliCommandContext, CliCommandDef } from "../../../../types/plugin";
import type { TickerRecord } from "../../../../types/ticker";
import {
  addTickerToPortfolio,
  createManualPortfolio,
  deleteManualPortfolio,
  findPortfolio,
  isManualPortfolio,
  removeTickerFromPortfolio,
  resolveManualPositionCurrency,
  setManualPortfolioPosition,
} from "../mutations";

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

async function showCollection(name: string, ctx: CliCommandContext) {
  const { config, store, dataProvider, persistence } = await ctx.initMarketData();
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
    ctx.closeAndFail(
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

function parseFiniteNumber(rawValue: string | undefined, label: string): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return value;
}

function requireManualPortfolio(config: AppConfig, rawName: string): NonNullable<ReturnType<typeof findPortfolio>> {
  const portfolio = findPortfolio(config, rawName);
  if (!portfolio) {
    throw new Error(`Portfolio "${rawName}" was not found.`);
  }
  if (!isManualPortfolio(portfolio)) {
    throw new Error(`Portfolio "${portfolio.name}" is broker-managed and cannot be modified manually.`);
  }
  return portfolio;
}

async function listCollections(ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();
  const tickers = await store.loadAllTickers();
  console.log(renderCollectionOverview(config, tickers));
  persistence.close();
}

async function createPortfolioCommand(name: string, ctx: CliCommandContext) {
  const { config, persistence } = await ctx.initConfigData();

  try {
    const result = createManualPortfolio(config, name, config.baseCurrency);
    await saveConfig(result.config);
    console.log(cliStyles.success(`Created portfolio "${result.portfolio.name}".`));
    console.log(renderStat("ID", result.portfolio.id));
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to create portfolio "${name}".`);
  }

  persistence.close();
}

async function deletePortfolioCommand(name: string, ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();

  try {
    const portfolio = requireManualPortfolio(config, name);
    const result = deleteManualPortfolio(config, await store.loadAllTickers(), portfolio.id);
    for (const ticker of result.tickers) {
      await store.saveTicker(ticker);
    }
    await saveConfig(result.config);
    console.log(cliStyles.success(`Deleted portfolio "${result.portfolio.name}".`));
    console.log(renderStat("Cleaned Tickers", String(result.cleanedTickerCount)));
    console.log(renderStat("Removed Positions", String(result.removedPositionCount)));
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to delete portfolio "${name}".`);
  }

  persistence.close();
}

async function addTickerToPortfolioCommand(portfolioName: string, symbol: string, ctx: CliCommandContext) {
  const { config, store, dataProvider, persistence } = await ctx.initMarketData();

  try {
    const portfolio = requireManualPortfolio(config, portfolioName);
    const ticker = await resolveTickerForCli(symbol, store, dataProvider);
    const result = addTickerToPortfolio(ticker, portfolio.id);
    if (!result.changed) {
      console.log(cliStyles.warning(`${ticker.metadata.ticker} is already in "${portfolio.name}".`));
      persistence.close();
      return;
    }
    await store.saveTicker(result.ticker);
    console.log(cliStyles.success(`Added ${result.ticker.metadata.ticker} to "${portfolio.name}".`));
    if (result.ticker.metadata.name) {
      console.log(renderStat("Name", result.ticker.metadata.name));
    }
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to add ${symbol} to "${portfolioName}".`);
  }

  persistence.close();
}

async function removeTickerFromPortfolioCommand(portfolioName: string, symbol: string, ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();
  const normalized = symbol.trim().toUpperCase();

  try {
    const portfolio = requireManualPortfolio(config, portfolioName);
    const ticker = await store.loadTicker(normalized);
    if (!ticker) {
      ctx.closeAndFail(persistence, `Ticker "${normalized}" was not found in your local data.`);
    }
    const result = removeTickerFromPortfolio(ticker, portfolio.id);
    if (!result.changed) {
      ctx.closeAndFail(persistence, `${normalized} is not in "${portfolio.name}".`);
    }
    await store.saveTicker(result.ticker);
    console.log(cliStyles.success(`Removed ${normalized} from "${portfolio.name}".`));
    console.log(renderStat("Removed Positions", String(result.removedPositionCount)));
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to remove ${symbol} from "${portfolioName}".`);
  }

  persistence.close();
}

async function setPositionCommand(
  portfolioName: string,
  symbol: string,
  sharesValue: string,
  avgCostValue: string,
  rawCurrency: string | undefined,
  ctx: CliCommandContext,
) {
  const { config, store, dataProvider, persistence } = await ctx.initMarketData();

  try {
    const portfolio = requireManualPortfolio(config, portfolioName);
    const ticker = await resolveTickerForCli(symbol, store, dataProvider);
    const shares = parseFiniteNumber(sharesValue, "Shares");
    const avgCost = parseFiniteNumber(avgCostValue, "Average cost");
    const currency = resolveManualPositionCurrency(rawCurrency, ticker, portfolio, config.baseCurrency);
    const result = setManualPortfolioPosition(ticker, portfolio.id, {
      shares,
      avgCost,
      currency,
    });
    await store.saveTicker(result.ticker);
    console.log(cliStyles.success(`Set position for ${result.ticker.metadata.ticker} in "${portfolio.name}".`));
    console.log(renderStat("Shares", String(shares)));
    console.log(renderStat("Average Cost", formatCurrency(avgCost, currency)));
    console.log(renderStat("Currency", currency));
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to set position for ${symbol} in "${portfolioName}".`);
  }

  persistence.close();
}

async function createWatchlist(name: string, ctx: CliCommandContext) {
  const { config, persistence } = await ctx.initConfigData();
  const trimmedName = name.trim();
  if (!trimmedName) {
    ctx.closeAndFail(persistence, "Usage: gloomberb watchlist create <name>");
  }

  const id = slugifyName(trimmedName, "watchlist");
  const duplicate = config.watchlists.some((watchlist) =>
    watchlist.id === id || watchlist.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    ctx.closeAndFail(persistence, `Watchlist "${trimmedName}" already exists.`);
  }

  const nextConfig = {
    ...config,
    watchlists: [...config.watchlists, { id, name: trimmedName }],
  };
  await saveConfig(nextConfig);
  console.log(cliStyles.success(`Created watchlist "${trimmedName}".`));
  console.log(renderStat("ID", id));
  persistence.close();
}

async function deleteWatchlist(name: string, ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();
  const watchlist = findWatchlist(config, name);
  if (!watchlist) {
    ctx.closeAndFail(persistence, `Watchlist "${name}" was not found.`);
  }

  const nextConfig = {
    ...config,
    watchlists: config.watchlists.filter((entry) => entry.id !== watchlist.id),
  };

  let cleanedTickers = 0;
  for (const ticker of await store.loadAllTickers()) {
    if (!ticker.metadata.watchlists.includes(watchlist.id)) continue;
    const nextTicker: TickerRecord = {
      ...ticker,
      metadata: {
        ...ticker.metadata,
        watchlists: ticker.metadata.watchlists.filter((entry) => entry !== watchlist.id),
      },
    };
    await store.saveTicker(nextTicker);
    cleanedTickers += 1;
  }

  await saveConfig(nextConfig);
  console.log(cliStyles.success(`Deleted watchlist "${watchlist.name}".`));
  console.log(renderStat("Cleaned Tickers", String(cleanedTickers)));
  persistence.close();
}

async function addTickerToWatchlist(watchlistName: string, symbol: string, ctx: CliCommandContext) {
  const { config, store, dataProvider, persistence } = await ctx.initMarketData();
  const watchlist = findWatchlist(config, watchlistName);
  if (!watchlist) {
    ctx.closeAndFail(persistence, `Watchlist "${watchlistName}" was not found.`);
  }

  try {
    const ticker = await resolveTickerForCli(symbol, store, dataProvider);
    if (ticker.metadata.watchlists.includes(watchlist.id)) {
      console.log(cliStyles.warning(`${ticker.metadata.ticker} is already in "${watchlist.name}".`));
      persistence.close();
      return;
    }

    const nextTicker: TickerRecord = {
      ...ticker,
      metadata: {
        ...ticker.metadata,
        watchlists: [...ticker.metadata.watchlists, watchlist.id],
      },
    };
    await store.saveTicker(nextTicker);
    console.log(cliStyles.success(`Added ${nextTicker.metadata.ticker} to "${watchlist.name}".`));
    if (nextTicker.metadata.name) {
      console.log(renderStat("Name", nextTicker.metadata.name));
    }
  } catch (error: any) {
    ctx.closeAndFail(persistence, error?.message || `Failed to add ${symbol} to "${watchlist.name}".`);
  }

  persistence.close();
}

async function removeTickerFromWatchlist(watchlistName: string, symbol: string, ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();
  const watchlist = findWatchlist(config, watchlistName);
  if (!watchlist) {
    ctx.closeAndFail(persistence, `Watchlist "${watchlistName}" was not found.`);
  }

  const normalized = symbol.trim().toUpperCase();
  const ticker = await store.loadTicker(normalized);
  if (!ticker) {
    ctx.closeAndFail(persistence, `Ticker "${normalized}" was not found in your local data.`);
  }
  if (!ticker.metadata.watchlists.includes(watchlist.id)) {
    ctx.closeAndFail(persistence, `${normalized} is not in "${watchlist.name}".`);
  }

  const nextTicker: TickerRecord = {
    ...ticker,
    metadata: {
      ...ticker.metadata,
      watchlists: ticker.metadata.watchlists.filter((entry) => entry !== watchlist.id),
    },
  };
  await store.saveTicker(nextTicker);
  console.log(cliStyles.success(`Removed ${normalized} from "${watchlist.name}".`));
  persistence.close();
}

async function listWatchlists(ctx: CliCommandContext) {
  const { config, store, persistence } = await ctx.initConfigData();
  const tickers = await store.loadAllTickers();

  console.log(renderSection("Watchlists"));
  if (config.watchlists.length === 0) {
    console.log(cliStyles.muted("No watchlists configured."));
    persistence.close();
    return;
  }

  console.log(renderTable(
    [
      { header: "Watchlist" },
      { header: "ID" },
      { header: "Tickers", align: "right" },
    ],
    config.watchlists.map((watchlist) => [
      watchlist.name,
      watchlist.id,
      String(countCollectionTickers(tickers, "watchlists", watchlist.id)),
    ]),
  ));
  persistence.close();
}

export const portfolioCliCommand: CliCommandDef = {
  name: "portfolio",
  description: "List, inspect, create, delete, and manage manual portfolios",
  help: {
    usage: ["portfolio [action]"],
    sections: [{
      title: "Portfolio Actions",
      columns: [
        { header: "Action" },
        { header: "Example" },
      ],
      rows: [
        ["list", "gloomberb portfolio list"],
        ["show", "gloomberb portfolio show Research"],
        ["show (legacy)", "gloomberb portfolio Research"],
        ["create", "gloomberb portfolio create Research"],
        ["delete", "gloomberb portfolio delete Research"],
        ["add", "gloomberb portfolio add Research ASML"],
        ["remove", "gloomberb portfolio remove Research ASML"],
        ["position set", "gloomberb portfolio position set Research ASML 10 800 EUR"],
      ],
    }],
  },
  execute: async (args, ctx) => {
    const action = args[0];

    if (!action || action === "list") {
      await listCollections(ctx);
      return;
    }

    if (action === "show") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb portfolio show <name>");
      await showCollection(name, ctx);
      return;
    }

    if (action === "create") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb portfolio create <name>");
      await createPortfolioCommand(name, ctx);
      return;
    }

    if (action === "delete" || action === "rm") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb portfolio delete <name>");
      await deletePortfolioCommand(name, ctx);
      return;
    }

    if (action === "add") {
      const symbol = args.at(-1);
      const name = args.slice(1, -1).join(" ");
      if (!name || !symbol) ctx.fail("Usage: gloomberb portfolio add <portfolio> <ticker>");
      await addTickerToPortfolioCommand(name!, symbol!, ctx);
      return;
    }

    if (action === "remove") {
      const symbol = args.at(-1);
      const name = args.slice(1, -1).join(" ");
      if (!name || !symbol) ctx.fail("Usage: gloomberb portfolio remove <portfolio> <ticker>");
      await removeTickerFromPortfolioCommand(name!, symbol!, ctx);
      return;
    }

    if (action === "position") {
      const subaction = args[1];
      if (subaction !== "set") {
        ctx.fail("Usage: gloomberb portfolio position set <portfolio> <ticker> <shares> <avg-cost> [currency]");
      }
      const [, , ...rest] = args;
      const currency = rest[4];
      if (rest.length < 4) {
        ctx.fail("Usage: gloomberb portfolio position set <portfolio> <ticker> <shares> <avg-cost> [currency]");
      }
      await setPositionCommand(rest[0]!, rest[1]!, rest[2]!, rest[3]!, currency, ctx);
      return;
    }

    await showCollection(args.join(" "), ctx);
  },
};

export const watchlistCliCommand: CliCommandDef = {
  name: "watchlist",
  aliases: ["watchlists"],
  description: "List, create, delete, add, or remove watchlists",
  help: {
    usage: ["watchlist [action]"],
    sections: [{
      title: "Watchlist Actions",
      columns: [
        { header: "Action" },
        { header: "Example" },
      ],
      rows: [
        ["list", "gloomberb watchlist list"],
        ["show", "gloomberb watchlist show Growth"],
        ["create", "gloomberb watchlist create Growth"],
        ["delete", "gloomberb watchlist delete Growth"],
        ["add", "gloomberb watchlist add Growth NVDA"],
        ["remove", "gloomberb watchlist remove Growth NVDA"],
      ],
    }],
  },
  execute: async (args, ctx) => {
    const action = args[0];

    if (!action || action === "list") {
      await listWatchlists(ctx);
      return;
    }

    if (action === "show") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb watchlist show <name>");
      await showCollection(name, ctx);
      return;
    }

    if (action === "create") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb watchlist create <name>");
      await createWatchlist(name, ctx);
      return;
    }

    if (action === "delete" || action === "rm") {
      const name = args.slice(1).join(" ");
      if (!name) ctx.fail("Usage: gloomberb watchlist delete <name>");
      await deleteWatchlist(name, ctx);
      return;
    }

    if (action === "add") {
      const symbol = args.at(-1);
      const name = args.slice(1, -1).join(" ");
      if (!name || !symbol) ctx.fail("Usage: gloomberb watchlist add <watchlist> <ticker>");
      await addTickerToWatchlist(name!, symbol!, ctx);
      return;
    }

    if (action === "remove") {
      const symbol = args.at(-1);
      const name = args.slice(1, -1).join(" ");
      if (!name || !symbol) ctx.fail("Usage: gloomberb watchlist remove <watchlist> <ticker>");
      await removeTickerFromWatchlist(name!, symbol!, ctx);
      return;
    }

    await showCollection(args.join(" "), ctx);
  },
};
