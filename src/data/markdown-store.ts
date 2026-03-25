import { readdir, readFile, writeFile, unlink, watch } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { TickerFile, TickerFrontmatter } from "../types/ticker";
import type { SqliteCache } from "./sqlite-cache";
import { parseTicker } from "../utils/frontmatter";

const DEFAULT_FRONTMATTER: Omit<TickerFrontmatter, "ticker" | "exchange" | "currency" | "name"> = {
  portfolios: [],
  watchlists: [],
  positions: [],
  custom: {},
  tags: [],
};

function parseFrontmatter(json: string): TickerFrontmatter {
  const data = JSON.parse(json);
  return {
    ...DEFAULT_FRONTMATTER,
    ticker: "",
    exchange: "",
    currency: "USD",
    name: "",
    ...data,
    portfolios: data.portfolios ?? [],
    watchlists: data.watchlists ?? [],
    positions: data.positions ?? [],
    custom: data.custom ?? {},
    tags: data.tags ?? [],
  };
}

/**
 * Manages ticker data using SQLite for metadata and .md files for notes.
 *
 * On first use, migrates any existing YAML-frontmatter markdown files
 * into SQLite, then strips the frontmatter from the .md files.
 */
export class MarkdownStore {
  constructor(
    private dataDir: string,
    private cache: SqliteCache,
  ) {}

  /** Migrate old YAML-frontmatter .md files into SQLite (runs once) */
  async migrate(): Promise<void> {
    if (this.cache.tickerCount() > 0) return; // Already migrated

    const files = await readdir(this.dataDir).catch(() => []);
    const mdFiles = files.filter((f: string) => f.endsWith(".md") && f !== "README.md");
    if (mdFiles.length === 0) return;

    for (const file of mdFiles) {
      try {
        const filePath = join(this.dataDir, file);
        const content = await readFile(filePath, "utf-8");
        const ticker = parseTicker(filePath, content);

        // Save frontmatter to SQLite
        this.cache.saveTicker(ticker.frontmatter.ticker, ticker.frontmatter);

        // Rewrite .md file to contain only notes (no frontmatter)
        await writeFile(filePath, ticker.notes || "", "utf-8");
      } catch {
        // Skip invalid files
      }
    }
  }

  async loadAllTickers(): Promise<TickerFile[]> {
    const rows = this.cache.getAllTickers();
    const tickers: TickerFile[] = [];

    for (const row of rows) {
      try {
        const frontmatter = parseFrontmatter(row.frontmatter);
        const notes = await this.loadNotes(row.symbol);
        tickers.push({
          frontmatter,
          notes,
          filePath: join(this.dataDir, `${row.symbol}.md`),
        });
      } catch {
        // Skip invalid entries
      }
    }

    return tickers;
  }

  async loadTicker(symbol: string): Promise<TickerFile | null> {
    const json = this.cache.getTicker(symbol);
    if (!json) return null;

    const frontmatter = parseFrontmatter(json);
    const notes = await this.loadNotes(symbol);
    return {
      frontmatter,
      notes,
      filePath: join(this.dataDir, `${symbol}.md`),
    };
  }

  async saveTicker(ticker: TickerFile): Promise<void> {
    // Save frontmatter to SQLite
    this.cache.saveTicker(ticker.frontmatter.ticker, ticker.frontmatter);

    // Save notes to .md file
    await writeFile(ticker.filePath, ticker.notes || "", "utf-8");
  }

  async createTicker(
    frontmatter: TickerFrontmatter,
    notes = "",
  ): Promise<TickerFile> {
    const filePath = join(this.dataDir, `${frontmatter.ticker}.md`);
    const ticker: TickerFile = { frontmatter, notes, filePath };
    await this.saveTicker(ticker);
    return ticker;
  }

  async deleteTicker(symbol: string): Promise<void> {
    this.cache.deleteTicker(symbol);
    const filePath = join(this.dataDir, `${symbol}.md`);
    try {
      await unlink(filePath);
    } catch {
      // File may not exist
    }
  }

  /** Load notes from a plain .md file (no frontmatter) */
  private async loadNotes(symbol: string): Promise<string> {
    const filePath = join(this.dataDir, `${symbol}.md`);
    try {
      const content = await readFile(filePath, "utf-8");
      return content.trim();
    } catch {
      return "";
    }
  }

  /** Watch for external changes to markdown files */
  watchChanges(callback: (event: string, filename: string) => void): AbortController {
    const ac = new AbortController();
    (async () => {
      try {
        const watcher = watch(this.dataDir, { signal: ac.signal });
        for await (const event of watcher) {
          if (event.filename?.endsWith(".md")) {
            callback(event.eventType, event.filename);
          }
        }
      } catch {
        // Aborted or error
      }
    })();
    return ac;
  }
}
