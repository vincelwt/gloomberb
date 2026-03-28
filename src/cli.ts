import { join } from "path";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { getPluginsDir } from "./plugins/loader";
import { getDataDir, loadConfig } from "./data/config-store";
import { AppPersistence } from "./data/app-persistence";
import { TickerRepository } from "./data/ticker-repository";
import { YahooFinanceClient } from "./sources/yahoo-finance";
import { VERSION } from "./version";
import { formatCurrency, formatPercentRaw, formatCompact, formatNumber } from "./utils/format";
import type { AppConfig } from "./types/config";
import type { TickerRecord } from "./types/ticker";

const PLUGINS_DIR = getPluginsDir();

function ensurePluginsDir() {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

/** Parse a GitHub reference into a clone URL and directory name */
function parseGitHubRef(ref: string): { url: string; name: string } {
  // Full URL: https://github.com/user/repo or https://github.com/user/repo.git
  if (ref.startsWith("https://github.com/")) {
    const clean = ref.replace(/\.git$/, "");
    const name = clean.split("/").pop()!;
    return { url: clean.endsWith(".git") ? ref : `${clean}.git`, name };
  }
  // github: prefix
  if (ref.startsWith("github:")) {
    ref = ref.slice(7);
  }
  // user/repo format
  if (ref.includes("/") && !ref.includes("://")) {
    const name = ref.split("/").pop()!;
    return { url: `https://github.com/${ref}.git`, name };
  }
  throw new Error(`Invalid plugin reference: ${ref}. Use user/repo or a GitHub URL.`);
}

async function install(ref: string) {
  ensurePluginsDir();
  const { url, name } = parseGitHubRef(ref);
  const targetDir = join(PLUGINS_DIR, name);

  if (existsSync(targetDir)) {
    console.log(`Plugin "${name}" already installed at ${targetDir}`);
    console.log(`Use "gloomberb update ${name}" to update it.`);
    process.exit(1);
  }

  console.log(`Installing ${name} from ${url}...`);
  try {
    execSync(`git clone --depth 1 ${url} ${targetDir}`, { stdio: "inherit" });
  } catch {
    console.error(`Failed to clone ${url}`);
    process.exit(1);
  }

  // Install dependencies if package.json exists
  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    console.log("Installing dependencies...");
    try {
      execSync("bun install", { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.error("Warning: Failed to install dependencies");
    }
  }

  // Validate the plugin
  try {
    let entryFile: string | null = null;
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      if (pkg.main) entryFile = join(targetDir, pkg.main);
    }
    if (!entryFile) {
      for (const c of ["index.ts", "index.tsx", "index.js"]) {
        const p = join(targetDir, c);
        if (existsSync(p)) { entryFile = p; break; }
      }
    }
    if (entryFile) {
      const mod = await import(entryFile);
      const plugin = mod.default ?? mod.plugin;
      if (plugin?.id && plugin?.name) {
        console.log(`\nInstalled ${plugin.name} v${plugin.version || "0.0.0"}`);
        return;
      }
    }
    console.log(`\nWarning: No valid GloomPlugin export found, but files were installed.`);
  } catch (err) {
    console.log(`\nWarning: Plugin validation failed: ${err}`);
    console.log("Files were installed but the plugin may not load correctly.");
  }
}

async function remove(name: string) {
  const targetDir = join(PLUGINS_DIR, name);
  if (!existsSync(targetDir)) {
    console.error(`Plugin "${name}" not found in ${PLUGINS_DIR}`);
    process.exit(1);
  }
  rmSync(targetDir, { recursive: true, force: true });
  console.log(`Removed plugin "${name}"`);
}

async function update(name?: string) {
  ensurePluginsDir();
  const dirs = name
    ? [name]
    : readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  if (dirs.length === 0) {
    console.log("No plugins installed.");
    return;
  }

  for (const dir of dirs) {
    const targetDir = join(PLUGINS_DIR, dir);
    if (!existsSync(join(targetDir, ".git"))) {
      console.log(`Skipping ${dir} (not a git repo)`);
      continue;
    }
    console.log(`Updating ${dir}...`);
    try {
      execSync("git pull", { cwd: targetDir, stdio: "inherit" });
      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        execSync("bun install", { cwd: targetDir, stdio: "inherit" });
      }
    } catch {
      console.error(`Failed to update ${dir}`);
    }
  }
}

function list() {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (entries.length === 0) {
    console.log("No plugins installed.");
    console.log(`\nInstall plugins with: gloomberb install <github-user/repo>`);
    return;
  }

  console.log("Installed plugins:\n");
  for (const entry of entries) {
    const dir = join(PLUGINS_DIR, entry.name);
    let info = entry.name;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require("fs").readFileSync(pkgPath, "utf-8"));
        if (pkg.version) info += ` v${pkg.version}`;
        if (pkg.description) info += ` - ${pkg.description}`;
      } catch { /* ignore */ }
    }
    console.log(`  ${info}`);
  }
  console.log(`\nPlugin directory: ${PLUGINS_DIR}`);
}

// --- Data init helper for commands that need the data layer ---

async function initData() {
  const dataDir = await getDataDir();
  if (!dataDir || !existsSync(dataDir)) {
    console.error("No data directory configured. Run gloomberb first to set up.");
    process.exit(1);
  }
  const config = await loadConfig(dataDir);
  const persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
  const store = new TickerRepository(persistence.tickers);
  const yahoo = new YahooFinanceClient();
  return { config, persistence, store, yahoo, dataDir };
}

// --- Help command ---

function help() {
  console.log(`gloomberb v${VERSION} — Bloomberg-style portfolio tracker

Usage: gloomberb [command]

Commands:
  (no command)          Launch the terminal UI
  help                  Show this help message
  portfolio [name]      List portfolios or show portfolio details
  ticker <symbol>       Show quote and fundamentals for a ticker
  install <user/repo>   Install a plugin from GitHub
  remove <name>         Remove an installed plugin
  update [name]         Update plugins
  plugins               List installed plugins`);
}

// --- Portfolio command ---

async function portfolio(name?: string) {
  const { config, store, yahoo, persistence } = await initData();
  const tickers = await store.loadAllTickers();

  if (!name) {
    // List all portfolios and watchlists with ticker counts
    console.log("Portfolios:");
    for (const p of config.portfolios) {
      const count = tickers.filter((t) => t.metadata.portfolios.includes(p.id)).length;
      console.log(`  ${p.name} (${p.currency})    ${count} ticker${count !== 1 ? "s" : ""}`);
    }
    if (config.watchlists.length > 0) {
      console.log("\nWatchlists:");
      for (const w of config.watchlists) {
        const count = tickers.filter((t) => t.metadata.watchlists.includes(w.id)).length;
        console.log(`  ${w.name}    ${count} ticker${count !== 1 ? "s" : ""}`);
      }
    }
    persistence.close();
    return;
  }

  // Find the portfolio or watchlist by name (case-insensitive)
  const lowerName = name.toLowerCase();
  const matchedPortfolio = config.portfolios.find((p) => p.name.toLowerCase() === lowerName || p.id.toLowerCase() === lowerName);
  const matchedWatchlist = config.watchlists.find((w) => w.name.toLowerCase() === lowerName || w.id.toLowerCase() === lowerName);

  if (!matchedPortfolio && !matchedWatchlist) {
    console.error(`Portfolio or watchlist "${name}" not found.`);
    console.error(`Available: ${[...config.portfolios.map((p) => p.name), ...config.watchlists.map((w) => w.name)].join(", ")}`);
    persistence.close();
    process.exit(1);
  }

  const isPortfolio = !!matchedPortfolio;
  const id = matchedPortfolio?.id ?? matchedWatchlist!.id;
  const displayName = matchedPortfolio?.name ?? matchedWatchlist!.name;
  const currency = matchedPortfolio?.currency ?? config.baseCurrency;

  const filtered = tickers.filter((t) =>
    isPortfolio ? t.metadata.portfolios.includes(id) : t.metadata.watchlists.includes(id),
  );

  if (filtered.length === 0) {
    console.log(`${displayName} — no tickers`);
    persistence.close();
    return;
  }

  console.log(`${displayName}${isPortfolio ? ` (${currency})` : ""}\n`);

  // Fetch quotes for all tickers
  const quotes = new Map<string, Awaited<ReturnType<typeof yahoo.getQuote>>>();
  await Promise.all(
    filtered.map(async (t) => {
      try {
        const q = await yahoo.getQuote(t.metadata.ticker, t.metadata.exchange);
        quotes.set(t.metadata.ticker, q);
      } catch { /* skip failed quotes */ }
    }),
  );

  if (isPortfolio) {
    // Show position details
    const header = "TICKER    PRICE         CHG%    SHARES  AVG COST      P&L";
    console.log(header);
    console.log("-".repeat(header.length));
    let totalPnl = 0;

    for (const t of filtered) {
      const q = quotes.get(t.metadata.ticker);
      const price = q ? formatCurrency(q.price, q.currency) : "—";
      const chg = q ? formatPercentRaw(q.changePercent) : "—";
      const positions = t.metadata.positions.filter((p) => p.portfolio === id);

      if (positions.length === 0) {
        console.log(`${t.metadata.ticker.padEnd(10)}${price.padStart(10)}  ${chg.padStart(8)}`);
      } else {
        for (const pos of positions) {
          const shares = pos.shares;
          const avgCost = pos.avgCost;
          const currentPrice = q?.price ?? 0;
          const pnl = (currentPrice - avgCost) * shares * (pos.multiplier ?? 1);
          totalPnl += pnl;
          const pnlStr = pnl >= 0 ? `+${formatCurrency(pnl, currency)}` : formatCurrency(pnl, currency);
          console.log(
            `${t.metadata.ticker.padEnd(10)}${price.padStart(10)}  ${chg.padStart(8)}  ${String(shares).padStart(6)}  ${formatCurrency(avgCost, currency).padStart(10)}  ${pnlStr.padStart(12)}`,
          );
        }
      }
    }

    console.log("-".repeat(header.length));
    const totalStr = totalPnl >= 0 ? `+${formatCurrency(totalPnl, currency)}` : formatCurrency(totalPnl, currency);
    console.log(`${"".padEnd(46)}Total: ${totalStr.padStart(12)}`);
  } else {
    // Watchlist: simpler view
    const header = "TICKER    PRICE         CHG%    MCAP";
    console.log(header);
    console.log("-".repeat(header.length));
    for (const t of filtered) {
      const q = quotes.get(t.metadata.ticker);
      const price = q ? formatCurrency(q.price, q.currency) : "—";
      const chg = q ? formatPercentRaw(q.changePercent) : "—";
      const mcap = q?.marketCap ? formatCompact(q.marketCap) : "—";
      console.log(`${t.metadata.ticker.padEnd(10)}${price.padStart(10)}  ${chg.padStart(8)}  ${mcap.padStart(6)}`);
    }
  }

  persistence.close();
}

// --- Ticker command ---

async function ticker(symbol: string) {
  const { config, store, yahoo, persistence } = await initData();

  // Fetch quote and fundamentals
  const tickerFile = await store.loadTicker(symbol.toUpperCase());
  const exchange = tickerFile?.metadata.exchange ?? "";

  let financials;
  try {
    financials = await yahoo.getTickerFinancials(symbol, exchange);
  } catch (err: any) {
    console.error(`Failed to fetch data for ${symbol}: ${err.message}`);
    persistence.close();
    process.exit(1);
  }

  const q = financials.quote;
  const f = financials.fundamentals;

  if (!q) {
    console.error(`No quote data for ${symbol}`);
    persistence.close();
    process.exit(1);
  }

  // Header
  const name = q.name || tickerFile?.metadata.name || symbol;
  console.log(`${q.symbol} — ${name}`);
  const parts = [];
  if (q.fullExchangeName || q.exchangeName) parts.push(`Exchange: ${q.fullExchangeName || q.exchangeName}`);
  parts.push(`Currency: ${q.currency}`);
  if (q.marketState) parts.push(`Market: ${q.marketState}`);
  console.log(parts.join("    "));

  // Price
  console.log(`\nPrice:     ${formatCurrency(q.price, q.currency)}  (${formatPercentRaw(q.changePercent)})`);
  if (q.high52w != null || q.low52w != null) {
    console.log(`52w High:  ${q.high52w != null ? formatCurrency(q.high52w, q.currency) : "—"}    52w Low: ${q.low52w != null ? formatCurrency(q.low52w, q.currency) : "—"}`);
  }

  // Extended hours
  if (q.preMarketPrice != null) {
    console.log(`Pre-Mkt:   ${formatCurrency(q.preMarketPrice, q.currency)}  (${formatPercentRaw(q.preMarketChangePercent)})`);
  }
  if (q.postMarketPrice != null) {
    console.log(`Post-Mkt:  ${formatCurrency(q.postMarketPrice, q.currency)}  (${formatPercentRaw(q.postMarketChangePercent)})`);
  }

  // Fundamentals
  if (f) {
    console.log("");
    const rows: [string, string, string, string][] = [];
    if (q.marketCap != null || f.trailingPE != null) {
      rows.push(["Market Cap", q.marketCap != null ? formatCompact(q.marketCap) : "—", "P/E", f.trailingPE != null ? formatNumber(f.trailingPE) : "—"]);
    }
    if (f.forwardPE != null || f.pegRatio != null) {
      rows.push(["Fwd P/E", f.forwardPE != null ? formatNumber(f.forwardPE) : "—", "PEG", f.pegRatio != null ? formatNumber(f.pegRatio) : "—"]);
    }
    if (f.eps != null || f.dividendYield != null) {
      rows.push(["EPS", f.eps != null ? formatCurrency(f.eps, q.currency) : "—", "Div Yield", f.dividendYield != null ? formatPercentRaw(f.dividendYield * 100) : "—"]);
    }
    if (f.revenue != null || f.netIncome != null) {
      rows.push(["Revenue", f.revenue != null ? formatCompact(f.revenue) : "—", "Net Income", f.netIncome != null ? formatCompact(f.netIncome) : "—"]);
    }
    if (f.operatingMargin != null || f.profitMargin != null) {
      rows.push(["Op Margin", f.operatingMargin != null ? formatPercentRaw(f.operatingMargin * 100) : "—", "Profit", f.profitMargin != null ? formatPercentRaw(f.profitMargin * 100) : "—"]);
    }

    for (const [k1, v1, k2, v2] of rows) {
      console.log(`${(k1 + ":").padEnd(12)} ${v1.padStart(8)}    ${(k2 + ":").padEnd(12)} ${v2.padStart(8)}`);
    }
  }

  // Position info if in a portfolio
  if (tickerFile && tickerFile.metadata.positions.length > 0) {
    console.log("");
    for (const pos of tickerFile.metadata.positions) {
      const portfolioName = config.portfolios.find((p) => p.id === pos.portfolio)?.name ?? pos.portfolio;
      const value = q.price * pos.shares * (pos.multiplier ?? 1);
      const pnl = (q.price - pos.avgCost) * pos.shares * (pos.multiplier ?? 1);
      const pnlStr = pnl >= 0 ? `+${formatCurrency(pnl, q.currency)}` : formatCurrency(pnl, q.currency);
      console.log(`Position (${portfolioName}):`);
      console.log(`  ${pos.shares} shares @ ${formatCurrency(pos.avgCost, q.currency)} = ${formatCurrency(value, q.currency)} (P&L: ${pnlStr})`);
    }
  }

  persistence.close();
}

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      help();
      return true;
    }
    case "portfolio": {
      await portfolio(args.slice(1).join(" ") || undefined);
      return true;
    }
    case "ticker": {
      const symbol = args[1];
      if (!symbol) {
        console.error("Usage: gloomberb ticker <symbol>");
        process.exit(1);
      }
      await ticker(symbol);
      return true;
    }
    case "install": {
      const ref = args[1];
      if (!ref) {
        console.error("Usage: gloomberb install <github-user/repo>");
        process.exit(1);
      }
      await install(ref);
      return true;
    }
    case "remove":
    case "uninstall": {
      const name = args[1];
      if (!name) {
        console.error("Usage: gloomberb remove <plugin-name>");
        process.exit(1);
      }
      await remove(name);
      return true;
    }
    case "update": {
      await update(args[1]);
      return true;
    }
    case "plugins":
    case "list": {
      list();
      return true;
    }
    default:
      return false;
  }
}
