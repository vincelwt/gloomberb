import { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useDialog, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import { commands, matchPrefix, type Command } from "./command-registry";
import type { YahooFinanceClient } from "../../sources/yahoo-finance";
import type { MarkdownStore } from "../../data/markdown-store";
import type { TickerFrontmatter } from "../../types/ticker";
import type { PluginRegistry } from "../../plugins/registry";
import type { CommandDef, WizardStep } from "../../types/plugin";
import type { PromptContext, AlertContext } from "@opentui-ui/dialog/react";

interface CommandBarProps {
  yahoo: YahooFinanceClient;
  markdownStore: MarkdownStore;
  pluginRegistry: PluginRegistry;
}

interface ResultItem {
  id: string;
  label: string;
  detail: string;
  right?: string;
  category: string;
  action: () => void | Promise<void>;
}

// --- Wizard dialog content components ---

function InfoStepContent({ dismiss, dialogId, step }: AlertContext & { step: WizardStep }) {
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "return") dismiss();
  }, dialogId);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
      </box>
      <box height={1} />
      {step.body?.map((line, i) => (
        <box key={i} height={1}>
          <text fg={
            line.startsWith("  ") && (line.includes("interactivebrokers") || line.includes("http"))
              ? colors.textBright
              : line.startsWith("  - ") ? colors.text : colors.textDim
          }>{line || " "}</text>
        </box>
      ))}
      <box height={1} />
      <text fg={colors.textMuted}>Press Enter to continue</text>
    </box>
  );
}

function InputStepContent({ resolve, step }: PromptContext<string> & { step: WizardStep }) {
  const inputRef = useRef<InputRenderable>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
      </box>
      <box height={1} />
      {step.body?.map((line, i) => (
        <box key={i} height={1}>
          <text fg={colors.textDim}>{line || " "}</text>
        </box>
      ))}
      <box height={1} />
      <box height={1}>
        <input
          ref={inputRef}
          placeholder={step.placeholder || ""}
          focused
          textColor={colors.text}
          placeholderColor={colors.textDim}
          backgroundColor={colors.bg}
          onInput={(val) => setValue(val)}
          onChange={(val) => setValue(val)}
          onSubmit={() => { if (value.trim()) resolve(value.trim()); }}
        />
      </box>
    </box>
  );
}

function ValidatingContent({ dismiss, dialogId, step }: AlertContext & { step: WizardStep }) {
  // No keyboard — auto-dismissed by the caller after execute
  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
      </box>
      <box height={1} />
      <text fg={colors.textDim}>{step.body?.[0] || "Processing..."}</text>
    </box>
  );
}

function ResultContent({ dismiss, dialogId, message, isError }: AlertContext & { message: string; isError: boolean }) {
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "return" || event.name === "escape") dismiss();
  }, dialogId);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={isError ? colors.negative : colors.positive}>
          {isError ? "Connection Failed" : "Success"}
        </text>
      </box>
      <box height={1} />
      <text fg={isError ? colors.negative : colors.positive}>{message}</text>
      <box height={1} />
      <text fg={colors.textMuted}>Press Enter to close</text>
    </box>
  );
}

export function CommandBar({ yahoo, markdownStore, pluginRegistry }: CommandBarProps) {
  const { state, dispatch } = useAppState();
  const dialog = useDialog();
  const { width: termWidth } = useTerminalDimensions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<InputRenderable>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const close = useCallback(() => {
    dispatch({ type: "SET_COMMAND_BAR", open: false });
    setQuery("");
    setResults([]);
    setSelectedIdx(0);
  }, [dispatch]);

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
      case "refresh":
      case "refresh-all":
        close();
        break;
      default:
        cmd.execute(dispatch, ctx);
        close();
    }
  }, [state, dispatch, markdownStore, close]);

  const openTickerDetail = useCallback((symbol: string, name: string, exchange: string) => {
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

  // Run a wizard command through sequential dialogs
  const runWizard = useCallback(async (cmd: CommandDef) => {
    const steps = cmd.wizard!;
    const values: Record<string, string> = {};

    for (const step of steps) {
      const isValidate = step.type === "info" && step.key.startsWith("_validate");

      if (isValidate) {
        // Show a non-interactive "connecting" dialog, run execute, then show result
        const dialogId = dialog.show({
          content: () => (
            <box flexDirection="column">
              <box height={1}>
                <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
              </box>
              <box height={1} />
              <text fg={colors.textDim}>{step.body?.[0] || "Processing..."}</text>
            </box>
          ),
        });

        try {
          await cmd.execute(values);
          dialog.close(dialogId);
          await dialog.alert({
            content: (ctx) => <ResultContent {...ctx} message="Connected! Positions will sync automatically." isError={false} />,
          });
        } catch (err: any) {
          dialog.close(dialogId);
          await dialog.alert({
            content: (ctx) => <ResultContent {...ctx} message={err.message || "Connection failed"} isError={true} />,
          });
        }
        return; // Wizard complete after validate step
      }

      if (step.type === "info") {
        await dialog.alert({
          content: (ctx) => <InfoStepContent {...ctx} step={step} />,
        });
        continue;
      }

      // text or password step
      const result = await dialog.prompt<string>({
        content: (ctx) => <InputStepContent {...ctx} step={step} />,
      });

      if (result === undefined) return; // User cancelled (Esc)
      values[step.key] = result;
    }

    // If no validate step, just execute
    try {
      await cmd.execute(values);
    } catch {
      // silently fail
    }
  }, [dialog]);

  // Convert plugin commands to ResultItems
  const pluginCommandItems = useCallback((): ResultItem[] => {
    return [...pluginRegistry.commands.values()].map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      detail: cmd.description || "",
      category: "Plugins",
      action: () => {
        close();
        if (cmd.wizard && cmd.wizard.length > 0) {
          runWizard(cmd);
        } else {
          (async () => {
            try {
              await cmd.execute();
            } catch {
              // silently fail
            }
          })();
        }
      },
    }));
  }, [pluginRegistry.commands, close, runWizard]);

  // Build results based on query and prefix matching
  useEffect(() => {
    const items: ResultItem[] = [];
    const match = matchPrefix(query);

    if (match && match.command.id === "search-ticker") {
      if (!match.arg) {
        items.push({ id: "hint", label: "Type a ticker symbol...", detail: "", category: "Search", action: () => {} });
      }
    } else if (match && !match.command.hasArg) {
      items.push({
        id: match.command.id,
        label: match.command.label,
        detail: match.command.description,
        right: match.command.prefix,
        category: match.command.category,
        action: () => executeCommand(match.command, match.arg),
      });
    } else if (!query) {
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
          id: cmd.id, label: cmd.label, detail: cmd.description,
          right: cmd.prefix, category: cmd.category,
          action: () => executeCommand(cmd, ""),
        });
      }
      items.push(...pluginCommandItems());
    } else {
      const tickerItems: ResultItem[] = Array.from(state.tickers.values()).map((t) => ({
        id: `goto:${t.frontmatter.ticker}`, label: t.frontmatter.ticker,
        detail: t.frontmatter.name, category: "Tickers",
        action: () => { dispatch({ type: "SELECT_TICKER", symbol: t.frontmatter.ticker }); close(); },
      }));
      const cmdItems: ResultItem[] = commands.map((cmd) => ({
        id: cmd.id, label: cmd.label, detail: cmd.description,
        right: cmd.prefix, category: cmd.category,
        action: () => executeCommand(cmd, ""),
      }));
      const allItems = [...tickerItems, ...cmdItems, ...pluginCommandItems()];
      const filtered = fuzzyFilter(allItems, query, (i) => `${i.label} ${i.detail} ${i.right || ""}`);
      items.push(...filtered);
    }

    setResults(items);
    setSelectedIdx(0);

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
                id: `yahoo:${r.symbol}`, label: sym, detail: r.name,
                right: r.exchange, category: isExisting ? "Open" : "Search Results",
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

  useKeyboard((event) => {
    if (event.name === "escape" || event.name === "`") {
      close();
    } else if (event.name === "down" || (event.name === "n" && event.ctrl)) {
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (event.name === "up" || (event.name === "p" && event.ctrl)) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (event.name === "return" || event.name === "enter") {
      const selected = results[selectedIdx];
      if (selected) selected.action();
    }
  });

  // Layout
  const barWidth = Math.min(Math.floor(termWidth * 0.6), 72);
  const barLeft = Math.floor((termWidth - barWidth) / 2);
  const maxVisible = 10;
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
    ? `${activeMatch.command.prefix}: ${activeMatch.command.label}${activeMatch.command.hasArg ? ` \u2014 ${activeMatch.command.argPlaceholder}` : ""}`
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
      <scrollbox flexGrow={1} scrollY maxHeight={Math.min(gIdx + grouped.length * 2 + 2, 18)}>
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
              {gi > 0 && <box height={1} />}
              <box height={1} paddingX={2}>
                <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                  {group.category}
                </text>
              </box>
              {group.items.map((item) => {
                const isSel = item.globalIdx === selectedIdx;
                return (
                  <box
                    key={item.id}
                    flexDirection="row"
                    height={1}
                    paddingX={2}
                    backgroundColor={isSel ? colors.selected : colors.commandBg}
                  >
                    <box width={5}>
                      <text fg={colors.textMuted}>{item.right || ""}</text>
                    </box>
                    <box width={Math.floor(barWidth * 0.3)}>
                      <text fg={isSel ? colors.text : colors.textDim}>{item.label}</text>
                    </box>
                    <box flexGrow={1}>
                      <text fg={colors.textMuted}>{item.detail}</text>
                    </box>
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
