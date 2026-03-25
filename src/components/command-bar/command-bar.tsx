import { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import { commands, matchPrefix, getThemeOptions, type Command } from "./command-registry";
import { getCurrentThemeId, applyTheme } from "../../theme/colors";
import { saveConfig } from "../../data/config-store";
import type { YahooFinanceClient } from "../../sources/yahoo-finance";
import type { MarkdownStore } from "../../data/markdown-store";
import type { TickerFrontmatter } from "../../types/ticker";

interface CommandBarProps {
  yahoo: YahooFinanceClient;
  markdownStore: MarkdownStore;
}

interface ResultItem {
  id: string;
  label: string;
  detail: string;
  right?: string;
  category: string;
  themeId?: string; // for theme items — enables live preview
  action: () => void | Promise<void>;
}

export function CommandBar({ yahoo, markdownStore }: CommandBarProps) {
  const { state, dispatch } = useAppState();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<InputRenderable>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalThemeRef = useRef<string>(getCurrentThemeId());

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const close = useCallback(() => {
    dispatch({ type: "SET_COMMAND_BAR", open: false });
    setQuery("");
    setResults([]);
    setSelectedIdx(0);
  }, [dispatch]);

  // Revert theme on close without selection
  const closeAndRevert = useCallback(() => {
    dispatch({ type: "SET_THEME", theme: originalThemeRef.current });
    close();
  }, [dispatch, close]);

  // Handle prefix-based command execution
  const executeCommand = useCallback((cmd: Command, arg: string) => {
    const ctx = { selectedTicker: state.selectedTicker, activeLeftTab: state.activeLeftTab };

    switch (cmd.id) {
      case "add-watchlist":
      case "add-portfolio": {
        const ticker = state.tickers.get(state.selectedTicker || "");
        if (!ticker) return;
        const isWatchlist = cmd.id === "add-watchlist";
        const listId = state.activeLeftTab;
        const list = isWatchlist ? ticker.frontmatter.watchlists : ticker.frontmatter.portfolios;
        if (!list.includes(listId)) {
          list.push(listId);
          markdownStore.saveTicker(ticker).catch(() => {});
          dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
        }
        close();
        break;
      }
      case "remove-watchlist":
      case "remove-portfolio": {
        const ticker = state.tickers.get(state.selectedTicker || "");
        if (!ticker) return;
        const isWatchlist = cmd.id === "remove-watchlist";
        const field = isWatchlist ? "watchlists" : "portfolios";
        const listId = state.activeLeftTab;
        ticker.frontmatter[field] = ticker.frontmatter[field].filter((id) => id !== listId);
        markdownStore.saveTicker(ticker).catch(() => {});
        dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
        close();
        break;
      }
      case "refresh": {
        // Trigger via keyboard event passthrough
        close();
        break;
      }
      case "refresh-all": {
        close();
        break;
      }
      default:
        cmd.execute(dispatch, ctx);
        close();
    }
  }, [state, dispatch, markdownStore, close]);

  const openTickerDetail = useCallback((symbol: string, name: string, exchange: string) => {
    // Create markdown file if it doesn't exist, then select it
    (async () => {
      let existing = await markdownStore.loadTicker(symbol);
      if (!existing) {
        const frontmatter: TickerFrontmatter = {
          ticker: symbol, exchange, currency: "USD", name,
          portfolios: [], watchlists: [], positions: [], custom: {}, tags: [],
        };
        existing = await markdownStore.createTicker(frontmatter);
      }
      dispatch({ type: "UPDATE_TICKER", ticker: existing });
      dispatch({ type: "SELECT_TICKER", symbol });
      close();
    })();
  }, [markdownStore, dispatch, close]);

  // Detect if we're in theme mode
  const isThemeMode = matchPrefix(query)?.command.id === "theme";

  // Build results based on query and prefix matching
  useEffect(() => {
    const items: ResultItem[] = [];
    const match = matchPrefix(query);

    let initialIdx = 0;

    if (match && match.command.id === "theme") {
      // Theme selection mode
      const themeOptions = getThemeOptions();
      const savedThemeId = originalThemeRef.current;
      const filtered = match.arg
        ? themeOptions.filter((t) => t.name.toLowerCase().includes(match.arg.toLowerCase()) || t.id.includes(match.arg.toLowerCase()))
        : themeOptions;
      for (let i = 0; i < filtered.length; i++) {
        const t = filtered[i]!;
        const isSaved = t.id === savedThemeId;
        if (isSaved) initialIdx = i;
        items.push({
          id: `theme:${t.id}`,
          label: t.name,
          detail: t.description,
          right: isSaved ? "current" : undefined,
          themeId: t.id,
          category: "Themes",
          action: () => {
            originalThemeRef.current = t.id;
            dispatch({ type: "SET_THEME", theme: t.id });
            saveConfig({ ...state.config, theme: t.id }).catch(() => {});
            close();
          },
        });
      }
    } else if (match && match.command.id === "search-ticker") {
      // Ticker search mode - show "Searching..." until results come in
      // Don't show anything else, just Yahoo results
      if (!match.arg) {
        items.push({ id: "hint", label: "Type a ticker symbol...", detail: "", category: "Search", action: () => {} });
      }
    } else if (match && !match.command.hasArg) {
      // Direct command match - show it as the only option for quick execute
      items.push({
        id: match.command.id,
        label: match.command.label,
        detail: match.command.description,
        right: match.command.prefix,
        category: match.command.category,
        action: () => executeCommand(match.command, match.arg),
      });
    } else if (!query) {
      // Empty query - show existing tickers and all commands
      for (const t of state.tickers.values()) {
        items.push({
          id: `goto:${t.frontmatter.ticker}`,
          label: t.frontmatter.ticker,
          detail: t.frontmatter.name,
          category: "Tickers",
          action: () => { dispatch({ type: "SELECT_TICKER", symbol: t.frontmatter.ticker }); close(); },
        });
      }
      for (const cmd of commands) {
        items.push({
          id: cmd.id,
          label: cmd.label,
          detail: cmd.description,
          right: cmd.prefix,
          category: cmd.category,
          action: () => executeCommand(cmd, ""),
        });
      }
    } else {
      // Fuzzy filter across tickers and commands
      const tickerItems: ResultItem[] = Array.from(state.tickers.values()).map((t) => ({
        id: `goto:${t.frontmatter.ticker}`,
        label: t.frontmatter.ticker,
        detail: t.frontmatter.name,
        category: "Tickers",
        action: () => { dispatch({ type: "SELECT_TICKER", symbol: t.frontmatter.ticker }); close(); },
      }));
      const cmdItems: ResultItem[] = commands.map((cmd) => ({
        id: cmd.id,
        label: cmd.label,
        detail: cmd.description,
        right: cmd.prefix,
        category: cmd.category,
        action: () => executeCommand(cmd, ""),
      }));

      const allItems: ResultItem[] = [...tickerItems, ...cmdItems];
      const filtered = fuzzyFilter(allItems, query, (i) => `${i.label} ${i.detail} ${i.right || ""}`);
      items.push(...filtered);
    }

    setResults(items);
    setSelectedIdx(initialIdx);

    // Yahoo search when in ticker search mode (prefix "T")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (match?.command.id === "search-ticker" && match.arg.length >= 1) {
      const searchQuery = match.arg;
      setSearching(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const searchResults = await yahoo.search(searchQuery);
          const yahooItems: ResultItem[] = searchResults
            .filter((r) => r.type === "EQUITY" || r.type === "ETF")
            .slice(0, 8)
            .map((r) => {
              const sym = r.symbol.split(".")[0]!;
              const isExisting = state.tickers.has(sym);
              return {
                id: `yahoo:${r.symbol}`,
                label: sym,
                detail: r.name,
                right: r.exchange,
                category: isExisting ? "Open" : "Search Results",
                action: () => openTickerDetail(sym, r.name, r.exchange),
              };
            });
          setResults(yahooItems.length > 0 ? yahooItems : [{
            id: "no-results", label: "No results", detail: `for "${searchQuery}"`, category: "Search", action: () => {},
          }]);
        } catch {
          setResults([{ id: "error", label: "Search failed", detail: "Check your connection", category: "Search", action: () => {} }]);
        } finally {
          setSearching(false);
        }
      }, 200);
    } else {
      setSearching(false);
    }

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [query, state.tickers, state.selectedTicker]);

  // Live preview: apply theme as user arrows through the list
  useEffect(() => {
    if (!isThemeMode) return;
    const selected = results[selectedIdx];
    if (selected?.themeId) {
      applyTheme(selected.themeId);
      // Force a re-render by dispatching a no-op-like action
      dispatch({ type: "SET_THEME", theme: selected.themeId });
    }
  }, [selectedIdx, isThemeMode, results]);

  useKeyboard((event) => {
    if (event.name === "escape" || event.name === "`") {
      if (isThemeMode) {
        closeAndRevert();
      } else {
        close();
      }
    } else if (event.name === "down" || (event.name === "n" && event.ctrl)) {
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (event.name === "up" || (event.name === "p" && event.ctrl)) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (event.name === "enter") {
      const selected = results[selectedIdx];
      if (selected) selected.action();
    }
  });

  // Layout
  const barWidth = Math.min(Math.floor(termWidth * 0.6), 72);
  const barLeft = Math.floor((termWidth - barWidth) / 2);
  const maxVisible = 12;
  const visibleResults = results.slice(0, maxVisible);

  // Group by category
  const grouped: Array<{ category: string; items: Array<ResultItem & { globalIdx: number }> }> = [];
  let gIdx = 0;
  for (const result of visibleResults) {
    let group = grouped.find((g) => g.category === result.category);
    if (!group) { group = { category: result.category, items: [] }; grouped.push(group); }
    group.items.push({ ...result, globalIdx: gIdx++ });
  }

  // Detect active prefix for hint display
  const activeMatch = matchPrefix(query);
  const prefixHint = activeMatch
    ? `${activeMatch.command.prefix}: ${activeMatch.command.label}${activeMatch.command.hasArg ? ` — ${activeMatch.command.argPlaceholder}` : ""}`
    : null;

  return (
    <box
      position="absolute"
      top={3}
      left={barLeft}
      width={barWidth}
      flexDirection="column"
      backgroundColor={colors.commandBg}
      borderStyle="rounded"
      borderColor={colors.border}
      zIndex={100}
    >
      {/* Title */}
      <box flexDirection="row" height={1} paddingX={2}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>Commands</text>
        <box flexGrow={1} />
        <text fg={colors.textMuted}>esc</text>
      </box>

      {/* Search input */}
      <box height={1} paddingX={2}>
        <input
          ref={inputRef}
          placeholder="Type a command prefix or search..."
          focused
          textColor={colors.text}
          placeholderColor={colors.textDim}
          backgroundColor={colors.commandBg}
          onInput={(val) => setQuery(val)}
          onChange={(val) => setQuery(val)}
          onSubmit={() => {
            const selected = results[selectedIdx];
            if (selected) selected.action();
          }}
        />
      </box>

      {/* Prefix hint */}
      {prefixHint && (
        <box height={1} paddingX={2}>
          <text fg={colors.textBright}>{prefixHint}</text>
        </box>
      )}

      {/* Results */}
      <scrollbox flexGrow={1} scrollY maxHeight={Math.min(gIdx + grouped.length * 2 + 2, 20)}>
        {searching ? (
          <box paddingX={2} height={1}>
            <text fg={colors.textDim}>Searching Yahoo Finance...</text>
          </box>
        ) : grouped.length === 0 ? (
          <box paddingX={2} height={1}>
            <text fg={colors.textDim}>No results</text>
          </box>
        ) : (
          grouped.map((group, gi) => (
            <box key={group.category} flexDirection="column">
              {/* Spacing between groups */}
              {gi > 0 && <box height={1} />}
              {/* Category header */}
              <box height={1} paddingX={2}>
                <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                  {group.category}
                </text>
              </box>
              {/* Items */}
              {group.items.map((item) => {
                const isSel = item.globalIdx === selectedIdx;
                const isThemeItem = !!item.themeId;
                return (
                  <box
                    key={item.id}
                    flexDirection="row"
                    height={1}
                    paddingX={2}
                    backgroundColor={isSel ? colors.selected : colors.commandBg}
                  >
                    {/* Prefix shortcut column — hidden for theme items */}
                    {!isThemeItem && (
                      <box width={5}>
                        <text fg={colors.textMuted}>{item.right || ""}</text>
                      </box>
                    )}
                    {/* Label */}
                    <box width={isThemeItem ? Math.floor(barWidth * 0.35) : Math.floor(barWidth * 0.3)}>
                      <text fg={isSel ? colors.text : colors.textDim}>{item.label}</text>
                    </box>
                    {/* Description */}
                    <box flexGrow={1}>
                      <text fg={colors.textMuted}>{item.detail}</text>
                    </box>
                    {/* Right-side tag for theme items */}
                    {isThemeItem && item.right && (
                      <box>
                        <text fg={colors.textMuted}>{item.right}</text>
                      </box>
                    )}
                  </box>
                );
              })}
            </box>
          ))
        )}
      </scrollbox>
    </box>
  );
}
