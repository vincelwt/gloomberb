import { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useDialog, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import { commands, matchPrefix, getThemeOptions, type Command } from "./command-registry";
import { getCurrentThemeId, applyTheme } from "../../theme/colors";
import { saveConfig, resetAllData, exportConfig, importConfig } from "../../data/config-store";
import type { DataProvider } from "../../types/data-provider";
import type { MarkdownStore } from "../../data/markdown-store";
import type { TickerFile, TickerFrontmatter } from "../../types/ticker";
import type { PluginRegistry } from "../../plugins/registry";
import type { CommandDef, WizardStep } from "../../types/plugin";
import type { ColumnConfig } from "../../types/config";
import type { PromptContext, AlertContext } from "@opentui-ui/dialog/react";

/** All available columns that can be toggled */
const ALL_COLUMNS: ColumnConfig[] = [
  { id: "ticker", label: "TICKER", width: 8, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right", format: "currency" },
  { id: "change", label: "CHG", width: 9, align: "right", format: "currency" },
  { id: "change_pct", label: "CHG%", width: 8, align: "right", format: "percent" },
  { id: "ext_hours", label: "EXT%", width: 8, align: "right", format: "percent" },
  { id: "market_cap", label: "MCAP", width: 10, align: "right", format: "compact" },
  { id: "pe", label: "P/E", width: 7, align: "right", format: "number" },
  { id: "forward_pe", label: "FWD P/E", width: 8, align: "right", format: "number" },
  { id: "dividend_yield", label: "DIV%", width: 7, align: "right", format: "percent" },
  { id: "shares", label: "SHARES", width: 9, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "cost_basis", label: "COST", width: 10, align: "right", format: "compact" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
  { id: "latency", label: "AGE", width: 6, align: "right" },
];

interface CommandBarProps {
  dataProvider: DataProvider;
  markdownStore: MarkdownStore;
  pluginRegistry: PluginRegistry;
}

interface ResultItem {
  id: string;
  label: string;
  detail: string;
  right?: string;
  category: string;
  themeId?: string; // for theme items — enables live preview
  pluginToggle?: () => void; // for plugin items — toggle with space
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

function ConfirmDestroyContent({ resolve, dialogId }: PromptContext<boolean>) {
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "return" || event.name === "y") resolve(true);
    if (event.name === "escape" || event.name === "n") resolve(false);
  }, dialogId);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.negative}>{"Reset All Data"}</text>
      </box>
      <box height={1} />
      <text fg={colors.text}>This will permanently delete all portfolios, tickers,</text>
      <text fg={colors.text}>notes, broker credentials, and settings.</text>
      <box height={1} />
      <text fg={colors.text}>Gloomberb will quit and show the setup wizard on</text>
      <text fg={colors.text}>next launch.</text>
      <box height={1} />
      <text fg={colors.negative} attributes={TextAttributes.BOLD}>This cannot be undone.</text>
      <box height={1} />
      <text fg={colors.textMuted}>Press Y or Enter to confirm, Esc or N to cancel</text>
    </box>
  );
}

function ChoiceContent({ resolve, dialogId, title, choices }: PromptContext<string> & { title: string; choices: Array<{ id: string; label: string; desc: string }> }) {
  const [idx, setIdx] = useState(0);
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setIdx((i) => Math.max(0, i - 1));
    else if (event.name === "down" || event.name === "j") setIdx((i) => Math.min(choices.length - 1, i + 1));
    else if (event.name === "return") resolve(choices[idx]!.id);
    else if (event.name === "escape") resolve("");
  }, dialogId);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>{title}</text>
      </box>
      <box height={1} />
      {choices.map((c, i) => {
        const isSel = i === idx;
        return (
          <box key={c.id} height={1} backgroundColor={isSel ? colors.selected : colors.commandBg}>
            <text fg={isSel ? colors.selectedText : colors.textDim}>
              {isSel ? "\u25b8 " : "  "}
            </text>
            <text fg={isSel ? colors.text : colors.textDim} attributes={isSel ? TextAttributes.BOLD : 0}>
              {c.label}
            </text>
          </box>
        );
      })}
      <box height={1} />
      <box height={1}>
        <text fg={colors.textDim}>{choices[idx]?.desc}</text>
      </box>
      <box height={1} />
      <text fg={colors.textMuted}>Use ↑↓ to choose · enter to select · esc to cancel</text>
    </box>
  );
}

function ConfirmContent({ resolve, dialogId, title, message }: PromptContext<boolean> & { title: string; message: string }) {
  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "return" || event.name === "y") resolve(true);
    if (event.name === "escape" || event.name === "n") resolve(false);
  }, dialogId);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.negative}>{title}</text>
      </box>
      <box height={1} />
      <text fg={colors.text}>{message}</text>
      <box height={1} />
      <text fg={colors.textMuted}>Press Y or Enter to confirm, Esc or N to cancel</text>
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

export function CommandBar({ dataProvider, markdownStore, pluginRegistry }: CommandBarProps) {
  const { state, dispatch } = useAppState();
  const dialog = useDialog();
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
      case "export-config": {
        const exportPath = (process.env.HOME || "~") + "/gloomberb-config-backup.json";
        close();
        (async () => {
          try {
            await exportConfig(state.config, exportPath);
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={`Config exported to ${exportPath}`} isError={false} />,
            });
          } catch (err: any) {
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={err.message || "Export failed"} isError={true} />,
            });
          }
        })();
        return;
      }
      case "import-config": {
        const importPath = (process.env.HOME || "~") + "/gloomberb-config-backup.json";
        close();
        (async () => {
          try {
            const imported = await importConfig(state.config.dataDir, importPath);
            dispatch({ type: "SET_CONFIG", config: imported });
            applyTheme(imported.theme);
            dispatch({ type: "SET_THEME", theme: imported.theme });
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={`Config imported from ${importPath}. Restart for full effect.`} isError={false} />,
            });
          } catch (err: any) {
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={err.message || "Import failed — file not found?"} isError={true} />,
            });
          }
        })();
        return;
      }
      case "reset-all-data": {
        close();
        (async () => {
          const confirmed = await dialog.prompt<boolean>({
            content: (ctx) => <ConfirmDestroyContent {...ctx} />,
          });
          if (confirmed) {
            await resetAllData(state.config.dataDir);
            process.exit(0);
          }
        })();
        return;
      }
      case "columns": {
        // Enter columns mode by setting the prefix
        setQuery("COL ");
        return;
      }
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
      case "new-watchlist": {
        close();
        (async () => {
          const name = await dialog.prompt<string>({
            content: (ctx) => <InputStepContent {...ctx} step={{
              key: "name", type: "text",
              label: "New Watchlist",
              body: ["Enter a name for your watchlist."],
              placeholder: "My Watchlist",
            }} />,
          });
          if (!name) return;
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `watchlist-${Date.now()}`;
          const newWatchlist = { id, name };
          const newConfig = { ...state.config, watchlists: [...state.config.watchlists, newWatchlist] };
          dispatch({ type: "SET_CONFIG", config: newConfig });
          dispatch({ type: "SET_LEFT_TAB", tab: id });
          saveConfig(newConfig).catch(() => {});
        })();
        return;
      }
      case "new-portfolio": {
        close();
        (async () => {
          // Build choices: manual + connectable brokers
          const choices: Array<{ id: string; label: string; desc: string }> = [
            { id: "manual", label: "Create Manual Portfolio", desc: "Add tickers and positions by hand" },
          ];
          for (const [brokerId, adapter] of pluginRegistry.brokers) {
            if (adapter.configSchema.length > 0) {
              choices.push({
                id: brokerId,
                label: `Connect ${adapter.name}`,
                desc: `Auto-import positions via ${adapter.name}`,
              });
            }
          }

          const choiceId = await dialog.prompt<string>({
            content: (ctx) => <ChoiceContent {...ctx} title="New Portfolio" choices={choices} />,
          });
          if (!choiceId) return;

          if (choiceId === "manual") {
            const name = await dialog.prompt<string>({
              content: (ctx) => <InputStepContent {...ctx} step={{
                key: "name", type: "text",
                label: "Name Your Portfolio",
                body: ["A portfolio tracks your positions with cost basis."],
                placeholder: "Main Portfolio",
              }} />,
            });
            if (!name) return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `portfolio-${Date.now()}`;
            const newPortfolio = { id, name, currency: state.config.baseCurrency || "USD" };
            const newConfig = { ...state.config, portfolios: [...state.config.portfolios, newPortfolio] };
            dispatch({ type: "SET_CONFIG", config: newConfig });
            dispatch({ type: "SET_LEFT_TAB", tab: id });
            saveConfig(newConfig).catch(() => {});
          } else {
            // Broker connect flow
            const adapter = [...pluginRegistry.brokers.values()].find((b) => b.id === choiceId);
            if (!adapter) return;
            const fields = adapter.configSchema.filter((f) => f.required);
            const values: Record<string, string> = {};

            for (const field of fields) {
              const val = await dialog.prompt<string>({
                content: (ctx) => <InputStepContent {...ctx} step={{
                  key: field.key,
                  type: field.type === "password" ? "password" : "text",
                  label: field.label,
                  body: field.placeholder ? [`${field.placeholder}`] : [],
                  placeholder: field.placeholder || `Enter ${field.label.toLowerCase()}`,
                }} />,
              });
              if (val === undefined) return; // User cancelled
              values[field.key] = val;
            }

            // Show connecting dialog and validate
            const dialogId = dialog.show({
              content: () => (
                <box flexDirection="column">
                  <box height={1}>
                    <text attributes={TextAttributes.BOLD} fg={colors.text}>{"Connecting..."}</text>
                  </box>
                  <box height={1} />
                  <text fg={colors.textDim}>Validating credentials and importing positions...</text>
                </box>
              ),
            });

            try {
              await pluginRegistry.updateBrokerConfigFn(choiceId, values);
              await pluginRegistry.syncBrokerFn(choiceId);
              dialog.close(dialogId);
              // Reload config to pick up broker-created portfolios
              const freshConfig = pluginRegistry.getConfigFn();
              dispatch({ type: "SET_CONFIG", config: freshConfig });
              // Switch to the broker's portfolio tab if one was created
              const brokerTab = freshConfig.portfolios.find((p) => p.id.startsWith(choiceId));
              if (brokerTab) dispatch({ type: "SET_LEFT_TAB", tab: brokerTab.id });
              await dialog.alert({
                content: (ctx) => <ResultContent {...ctx} message="Connected! Positions will sync automatically." isError={false} />,
              });
            } catch (err: any) {
              dialog.close(dialogId);
              await dialog.alert({
                content: (ctx) => <ResultContent {...ctx} message={err.message || "Connection failed"} isError={true} />,
              });
            }
          }
        })();
        return;
      }
      case "delete-watchlist": {
        close();
        (async () => {
          if (state.config.watchlists.length === 0) return;
          const choices = state.config.watchlists.map((w) => ({
            id: w.id, label: w.name, desc: `Delete watchlist "${w.name}"`,
          }));
          const choiceId = await dialog.prompt<string>({
            content: (ctx) => <ChoiceContent {...ctx} title="Delete Watchlist" choices={choices} />,
          });
          if (!choiceId) return;
          const wlName = state.config.watchlists.find((w) => w.id === choiceId)?.name || choiceId;
          const confirmed = await dialog.prompt<boolean>({
            content: (ctx) => <ConfirmContent {...ctx} title="Delete Watchlist" message={`Are you sure you want to delete "${wlName}"? Tickers will not be deleted.`} />,
          });
          if (!confirmed) return;
          const newConfig = { ...state.config, watchlists: state.config.watchlists.filter((w) => w.id !== choiceId) };
          dispatch({ type: "SET_CONFIG", config: newConfig });
          if (state.activeLeftTab === choiceId) {
            const fallback = newConfig.portfolios[0]?.id || newConfig.watchlists[0]?.id || "";
            dispatch({ type: "SET_LEFT_TAB", tab: fallback });
          }
          saveConfig(newConfig).catch(() => {});
        })();
        return;
      }
      case "delete-portfolio": {
        close();
        (async () => {
          // Only show non-broker-managed portfolios for deletion
          const deletable = state.config.portfolios.filter((p) =>
            !Object.keys(state.config.brokers).some((bId) => p.id.startsWith(bId))
          );
          if (deletable.length === 0) return;
          const choices = deletable.map((p) => ({
            id: p.id, label: p.name, desc: `Delete portfolio "${p.name}"`,
          }));
          const choiceId = await dialog.prompt<string>({
            content: (ctx) => <ChoiceContent {...ctx} title="Delete Portfolio" choices={choices} />,
          });
          if (!choiceId) return;
          const pName = state.config.portfolios.find((p) => p.id === choiceId)?.name || choiceId;
          const confirmed = await dialog.prompt<boolean>({
            content: (ctx) => <ConfirmContent {...ctx} title="Delete Portfolio" message={`Are you sure you want to delete "${pName}"? Tickers will not be deleted.`} />,
          });
          if (!confirmed) return;
          const newConfig = { ...state.config, portfolios: state.config.portfolios.filter((p) => p.id !== choiceId) };
          dispatch({ type: "SET_CONFIG", config: newConfig });
          if (state.activeLeftTab === choiceId) {
            const fallback = newConfig.portfolios[0]?.id || newConfig.watchlists[0]?.id || "";
            dispatch({ type: "SET_LEFT_TAB", tab: fallback });
          }
          saveConfig(newConfig).catch(() => {});
        })();
        return;
      }
      default:
        // Commands with hasArg are prefix-driven modes (theme, plugins, search)
        // — enter them by setting the query to their prefix instead of closing
        if (cmd.hasArg) {
          setQuery(cmd.prefix + " ");
          if (inputRef.current) {
            (inputRef.current as any).editBuffer?.setText?.(cmd.prefix + " ") ||
              (inputRef.current as any).setText?.(cmd.prefix + " ");
          }
          return;
        }
        cmd.execute(dispatch, ctx);
        close();
    }
  }, [state, dispatch, markdownStore, close, dialog, pluginRegistry]);

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

  // Detect special modes
  const isThemeMode = matchPrefix(query)?.command.id === "theme";
  const isPluginMode = matchPrefix(query)?.command.id === "plugins";
  const isColumnsMode = matchPrefix(query)?.command.id === "columns";

  // Toggle a column on/off
  const toggleColumn = useCallback((colId: string) => {
    const current = state.config.columns;
    const isActive = current.some((c) => c.id === colId);
    let newCols: ColumnConfig[];
    if (isActive) {
      // Don't allow removing all columns
      if (current.length <= 1) return;
      newCols = current.filter((c) => c.id !== colId);
    } else {
      const colDef = ALL_COLUMNS.find((c) => c.id === colId);
      if (!colDef) return;
      newCols = [...current, colDef];
    }
    const newConfig = { ...state.config, columns: newCols };
    dispatch({ type: "SET_CONFIG", config: newConfig });
    saveConfig(newConfig).catch(() => {});
  }, [state.config, dispatch]);

  // Build results based on query and prefix matching
  useEffect(() => {
    // --- Smart command filtering (computed fresh each effect run) ---
    const isWatchlistTab = state.config.watchlists.some((w) => w.id === state.activeLeftTab);
    const isPortfolioTab = state.config.portfolios.some((p) => p.id === state.activeLeftTab);
    const isBrokerManaged = Object.keys(state.config.brokers).some((brokerId) =>
      state.activeLeftTab.startsWith(brokerId),
    );
    const activeTabName = isWatchlistTab
      ? state.config.watchlists.find((w) => w.id === state.activeLeftTab)?.name
      : state.config.portfolios.find((p) => p.id === state.activeLeftTab)?.name;
    const tickerData = state.selectedTicker ? state.tickers.get(state.selectedTicker) : null;

    function shouldShow(cmd: Command): boolean {
      switch (cmd.id) {
        case "add-watchlist":
          if (!tickerData || !isWatchlistTab) return false;
          return !tickerData.frontmatter.watchlists.includes(state.activeLeftTab);
        case "remove-watchlist":
          if (!tickerData || !isWatchlistTab) return false;
          return tickerData.frontmatter.watchlists.includes(state.activeLeftTab);
        case "add-portfolio":
          if (!tickerData || !isPortfolioTab || isBrokerManaged) return false;
          return !tickerData.frontmatter.portfolios.includes(state.activeLeftTab);
        case "remove-portfolio":
          if (!tickerData || !isPortfolioTab || isBrokerManaged) return false;
          return tickerData.frontmatter.portfolios.includes(state.activeLeftTab);
        default:
          return true;
      }
    }

    function smartLabel(cmd: Command): string {
      const sym = state.selectedTicker;
      switch (cmd.id) {
        case "add-watchlist": return sym ? `Add ${sym} to Watchlist` : cmd.label;
        case "remove-watchlist": return sym ? `Remove ${sym} from Watchlist` : cmd.label;
        case "add-portfolio": return sym ? `Add ${sym} to Portfolio` : cmd.label;
        case "remove-portfolio": return sym ? `Remove ${sym} from Portfolio` : cmd.label;
        default: return cmd.label;
      }
    }

    function smartDetail(cmd: Command): string {
      switch (cmd.id) {
        case "add-watchlist":
        case "remove-watchlist":
        case "add-portfolio":
        case "remove-portfolio":
          return activeTabName ? `in "${activeTabName}"` : cmd.description;
        default:
          return cmd.description;
      }
    }

    function cmdToItem(cmd: Command): ResultItem | null {
      if (!shouldShow(cmd)) return null;
      return {
        id: cmd.id, label: smartLabel(cmd), detail: smartDetail(cmd),
        right: cmd.prefix, category: cmd.category,
        action: () => executeCommand(cmd, ""),
      };
    }
    const items: ResultItem[] = [];
    const match = matchPrefix(query);

    let initialIdx = 0;

    if (match && match.command.id === "plugins") {
      // Plugin management mode
      const toggleablePlugins = [...pluginRegistry.allPlugins.values()].filter((p) => p.toggleable);
      const disabledPlugins = state.config.disabledPlugins || [];
      const filtered = match.arg
        ? toggleablePlugins.filter((p) => p.name.toLowerCase().includes(match.arg.toLowerCase()) || p.id.includes(match.arg.toLowerCase()))
        : toggleablePlugins;
      for (const p of filtered) {
        const isEnabled = !disabledPlugins.includes(p.id);
        const toggleAction = () => {
          dispatch({ type: "TOGGLE_PLUGIN", pluginId: p.id });
          const newDisabled = isEnabled
            ? [...disabledPlugins, p.id]
            : disabledPlugins.filter((id) => id !== p.id);
          saveConfig({ ...state.config, disabledPlugins: newDisabled }).catch(() => {});
        };
        items.push({
          id: `plugin:${p.id}`,
          label: `${isEnabled ? "\u2713" : "\u2717"} ${p.name}`,
          detail: p.description || "",
          category: "Plugins",
          pluginToggle: toggleAction,
          action: toggleAction,
        });
      }
    } else if (match && match.command.id === "columns") {
      // Column toggle mode — show all available columns as a checklist
      const activeIds = new Set(state.config.columns.map((c) => c.id));
      for (const col of ALL_COLUMNS) {
        const isOn = activeIds.has(col.id);
        items.push({
          id: `col:${col.id}`,
          label: `${isOn ? "[\u2713]" : "[ ]"} ${col.label}`,
          detail: `${col.id}  w:${col.width}  ${col.align}`,
          right: col.format || "",
          category: "Columns",
          action: () => toggleColumn(col.id),
        });
      }
    } else if (match && match.command.id === "theme") {
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
      if (!match.arg) {
        items.push({ id: "hint", label: "Type a ticker symbol...", detail: "", category: "Search", action: () => {} });
      }
    } else if (match && !match.command.hasArg) {
      // Direct prefix match — still filter for smart commands
      if (shouldShow(match.command)) {
        items.push({
          id: match.command.id,
          label: smartLabel(match.command),
          detail: smartDetail(match.command),
          right: match.command.prefix,
          category: match.command.category,
          action: () => executeCommand(match.command, match.arg),
        });
      }
    } else if (!query) {
      // Show recently visited tickers (or first tickers if no history)
      const maxDefaultTickers = 5;
      const recentSymbols = state.recentTickers.slice(0, maxDefaultTickers);
      const recentTickers = recentSymbols
        .map((s) => state.tickers.get(s))
        .filter((t): t is TickerFile => t != null);
      // Fill remaining slots with other tickers if not enough recent ones
      if (recentTickers.length < maxDefaultTickers) {
        const recentSet = new Set(recentSymbols);
        for (const t of state.tickers.values()) {
          if (recentTickers.length >= maxDefaultTickers) break;
          if (!recentSet.has(t.frontmatter.ticker)) recentTickers.push(t);
        }
      }
      for (const t of recentTickers) {
        items.push({
          id: `goto:${t.frontmatter.ticker}`,
          label: t.frontmatter.ticker,
          detail: t.frontmatter.name,
          category: "Tickers",
          action: () => { dispatch({ type: "SELECT_TICKER", symbol: t.frontmatter.ticker }); close(); },
        });
      }
      for (const cmd of commands) {
        const item = cmdToItem(cmd);
        if (item) items.push(item);
      }
      items.push(...pluginCommandItems());
    } else {
      const tickerItems: ResultItem[] = Array.from(state.tickers.values()).map((t) => ({
        id: `goto:${t.frontmatter.ticker}`, label: t.frontmatter.ticker,
        detail: t.frontmatter.name, category: "Tickers",
        action: () => { dispatch({ type: "SELECT_TICKER", symbol: t.frontmatter.ticker }); close(); },
      }));
      const cmdItems: ResultItem[] = commands.map((cmd) => cmdToItem(cmd)).filter((item): item is ResultItem => item !== null);
      const allItems = [...tickerItems, ...cmdItems, ...pluginCommandItems()];
      const filtered = fuzzyFilter(allItems, query, (i) => `${i.label} ${i.detail} ${i.right || ""}`);
      items.push(...filtered);
    }

    setResults(items);
    // In columns mode, preserve the selected index across re-renders (toggling)
    if (match?.command.id === "columns") {
      setSelectedIdx((prev) => Math.min(prev, items.length - 1));
    } else {
      setSelectedIdx(initialIdx);
    }

    // Yahoo search when in ticker search mode (prefix "T")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (match?.command.id === "search-ticker" && match.arg.length >= 1) {
      const searchQuery = match.arg;
      setSearching(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const searchResults = await dataProvider.search(searchQuery);
          const searchItems: ResultItem[] = searchResults
            .filter((r) => r.type === "EQUITY" || r.type === "ETF")
            .slice(0, 8)
            .map((r) => {
              const sym = r.symbol.split(".")[0]!;
              const isExisting = state.tickers.has(sym);
              return {
                id: `search:${r.symbol}`, label: sym, detail: r.name,
                right: r.exchange, category: isExisting ? "Open" : "Search Results",
                action: () => openTickerDetail(sym, r.name, r.exchange),
              };
            });
          setResults(searchItems.length > 0 ? searchItems : [{
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
  }, [query, state.tickers, state.selectedTicker, state.activeLeftTab, state.config.watchlists, state.config.portfolios, state.config.brokers, state.config.disabledPlugins, state.config.columns, toggleColumn]);

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
    } else if (event.name === "space" && isPluginMode) {
      // Space toggles plugins without closing
      const selected = results[selectedIdx];
      if (selected?.pluginToggle) selected.pluginToggle();
    } else if (event.name === "space" && isColumnsMode) {
      // Toggle column with space
      const selected = results[selectedIdx];
      if (selected) selected.action();
    } else if (event.name === "return" || event.name === "enter") {
      if (isColumnsMode) {
        const selected = results[selectedIdx];
        if (selected) selected.action();
      } else {
        const selected = results[selectedIdx];
        if (selected) selected.action();
      }
    }
  });

  // Layout
  const barWidth = Math.min(Math.floor(termWidth * 0.6), 72);
  const barLeft = Math.floor((termWidth - barWidth) / 2);
  // Cap visible results based on terminal height
  // Reserve rows for: top offset (3) + border (2) + input (2) + separator (1) + esc hint (1) + scroll indicators (2)
  const maxVisible = Math.min(16, Math.max(4, termHeight - 11));

  // Compute a window of results centered on selectedIdx
  const halfWindow = Math.floor(maxVisible / 2);
  let windowStart = Math.max(0, Math.min(selectedIdx - halfWindow, results.length - maxVisible));
  if (windowStart < 0) windowStart = 0;
  const windowEnd = Math.min(results.length, windowStart + maxVisible);
  const windowedResults = results.slice(windowStart, windowEnd);
  const hasMoreAbove = windowStart > 0;
  const hasMoreBelow = windowEnd < results.length;

  // Group by category (preserving global indices for selection highlight)
  const grouped: Array<{ category: string; items: Array<ResultItem & { globalIdx: number }> }> = [];
  for (let i = 0; i < windowedResults.length; i++) {
    const result = windowedResults[i]!;
    let group = grouped.find((g) => g.category === result.category);
    if (!group) { group = { category: result.category, items: [] }; grouped.push(group); }
    group.items.push({ ...result, globalIdx: windowStart + i });
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
      {/* Spacer above input */}
      <box height={1} />

      {/* Search input */}
      <box height={1} paddingX={2}>
        <input
          ref={inputRef}
          placeholder="> Type a command or search..."
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

      {/* Separator between input and results */}
      <box height={1} paddingX={1}>
        <text fg={colors.border}>{"\u2500".repeat(barWidth - 2)}</text>
      </box>

      {/* Scroll-up indicator */}
      {hasMoreAbove && (
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>{"  \u2191 more"}</text>
        </box>
      )}

      {/* Results */}
      <box flexDirection="column" flexGrow={1}>
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
                const isThemeItem = !!item.themeId;
                const isPluginItem = item.id.startsWith("plugin:");
                const isColumnItem = item.id.startsWith("col:");
                const isSearchResult = item.id.startsWith("yahoo:") || item.id.startsWith("goto:");
                const isChecked = isColumnItem && item.label.includes("\u2713");
                return (
                  <box
                    key={item.id}
                    flexDirection="row"
                    height={1}
                    paddingX={2}
                    backgroundColor={isSel ? colors.selected : colors.commandBg}
                    onMouseMove={() => setSelectedIdx(item.globalIdx)}
                    onMouseDown={() => {
                      setSelectedIdx(item.globalIdx);
                      item.action();
                    }}
                  >
                    {/* Prefix shortcut column — shown only for commands (not tickers/themes/plugins/columns) */}
                    {!isThemeItem && !isPluginItem && !isSearchResult && !isColumnItem && (
                      <box width={5}>
                        <text fg={colors.textMuted}>{item.right || ""}</text>
                      </box>
                    )}
                    {/* Label */}
                    <box width={isColumnItem ? Math.floor(barWidth * 0.4) : (isThemeItem || isPluginItem) ? Math.floor(barWidth * 0.35) : isSearchResult ? 10 : Math.floor(barWidth * 0.3)}>
                      <text fg={isColumnItem ? (isChecked ? colors.text : colors.textDim) : (isSel ? colors.text : colors.textDim)}>
                        {item.label}
                      </text>
                    </box>
                    <box flexGrow={1}>
                      <text fg={colors.textMuted}>{item.detail}</text>
                    </box>
                    {/* Right-side tag */}
                    {(isThemeItem || isSearchResult) && item.right && (
                      <box>
                        <text fg={colors.textMuted}>{item.right}</text>
                      </box>
                    )}
                    {isColumnItem && item.right && (
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
      </box>

      {/* Scroll-down indicator */}
      {hasMoreBelow && (
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>{"  \u2193 more"}</text>
        </box>
      )}

      {/* Bottom padding + hint */}
      <box flexDirection="row" height={1} paddingX={2}>
        <box flexGrow={1}>
          {isPluginMode && <text fg={colors.textMuted}>space toggle</text>}
          {isColumnsMode && <text fg={colors.textMuted}>space/enter toggle</text>}
        </box>
        <text fg={colors.textMuted}>esc to close</text>
      </box>
    </box>
  );
}
