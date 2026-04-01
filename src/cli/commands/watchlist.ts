import { saveConfig } from "../../data/config-store";
import {
  cliStyles,
  renderSection,
  renderStat,
  renderTable,
} from "../../utils/cli-output";
import type { TickerRecord } from "../../types/ticker";
import { initConfigData, initMarketData } from "../context";
import { closeAndFail, fail } from "../errors";
import {
  countCollectionTickers,
  findWatchlist,
  slugifyName,
} from "../helpers";
import { resolveTickerForCli } from "../ticker-resolution";
import { showCollection } from "./portfolio";

async function createWatchlist(name: string) {
  const { config, persistence } = await initConfigData();
  const trimmedName = name.trim();
  if (!trimmedName) {
    closeAndFail(persistence, "Usage: gloomberb watchlist create <name>");
  }

  const id = slugifyName(trimmedName, "watchlist");
  const duplicate = config.watchlists.some((watchlist) =>
    watchlist.id === id || watchlist.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    closeAndFail(persistence, `Watchlist "${trimmedName}" already exists.`);
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

async function deleteWatchlist(name: string) {
  const { config, store, persistence } = await initConfigData();
  const watchlist = findWatchlist(config, name);
  if (!watchlist) {
    closeAndFail(persistence, `Watchlist "${name}" was not found.`);
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

async function addTickerToWatchlist(watchlistName: string, symbol: string) {
  const { config, store, dataProvider, persistence } = await initMarketData();
  const watchlist = findWatchlist(config, watchlistName);
  if (!watchlist) {
    closeAndFail(persistence, `Watchlist "${watchlistName}" was not found.`);
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
  } catch (err: any) {
    closeAndFail(persistence, err?.message || `Failed to add ${symbol} to "${watchlist.name}".`);
  }

  persistence.close();
}

async function removeTickerFromWatchlist(watchlistName: string, symbol: string) {
  const { config, store, persistence } = await initConfigData();
  const watchlist = findWatchlist(config, watchlistName);
  if (!watchlist) {
    closeAndFail(persistence, `Watchlist "${watchlistName}" was not found.`);
  }

  const normalized = symbol.trim().toUpperCase();
  const ticker = await store.loadTicker(normalized);
  if (!ticker) {
    closeAndFail(persistence, `Ticker "${normalized}" was not found in your local data.`);
  }
  if (!ticker.metadata.watchlists.includes(watchlist.id)) {
    closeAndFail(persistence, `${normalized} is not in "${watchlist.name}".`);
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

async function listWatchlists() {
  const { config, store, persistence } = await initConfigData();
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

export async function watchlist(args: string[]) {
  const action = args[0];

  if (!action || action === "list") {
    await listWatchlists();
    return;
  }

  if (action === "show") {
    const name = args.slice(1).join(" ");
    if (!name) fail("Usage: gloomberb watchlist show <name>");
    await showCollection(name);
    return;
  }

  if (action === "create") {
    const name = args.slice(1).join(" ");
    if (!name) fail("Usage: gloomberb watchlist create <name>");
    await createWatchlist(name);
    return;
  }

  if (action === "delete" || action === "rm") {
    const name = args.slice(1).join(" ");
    if (!name) fail("Usage: gloomberb watchlist delete <name>");
    await deleteWatchlist(name);
    return;
  }

  if (action === "add") {
    const symbol = args.at(-1);
    const name = args.slice(1, -1).join(" ");
    if (!name || !symbol) fail("Usage: gloomberb watchlist add <watchlist> <ticker>");
    await addTickerToWatchlist(name, symbol);
    return;
  }

  if (action === "remove") {
    const symbol = args.at(-1);
    const name = args.slice(1, -1).join(" ");
    if (!name || !symbol) fail("Usage: gloomberb watchlist remove <watchlist> <ticker>");
    await removeTickerFromWatchlist(name, symbol);
    return;
  }

  await showCollection(args.join(" "));
}
