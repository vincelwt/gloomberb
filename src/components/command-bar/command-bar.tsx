import { useState, useCallback, useRef, useEffect } from "react";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { Spinner } from "../spinner";
import type { InputRenderable } from "@opentui/core";
import { useDialog, useDialogKeyboard } from "@opentui-ui/dialog/react";
import {
  colors,
  commandBarBg,
  commandBarHeadingText,
  commandBarHoverBg,
  commandBarSelectedBg,
  commandBarSelectedText,
  commandBarSubtleText,
  commandBarText,
} from "../../theme/colors";
import { getFocusedCollectionId, useAppState, useFocusedTicker } from "../../state/app-context";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import { commands, matchPrefix, getThemeOptions, type Command } from "./command-registry";
import { getCurrentThemeId, applyTheme } from "../../theme/colors";
import { saveConfig, resetAllData, exportConfig, importConfig } from "../../data/config-store";
import type { DataProvider } from "../../types/data-provider";
import type { MarkdownStore } from "../../data/markdown-store";
import type { TickerFile, TickerFrontmatter } from "../../types/ticker";
import type { PluginRegistry } from "../../plugins/registry";
import type { CommandDef, WizardStep } from "../../types/plugin";
import { findPaneInstance, type ColumnConfig } from "../../types/config";
import type { PromptContext, AlertContext } from "@opentui-ui/dialog/react";
import { resolveBrokerConfigFields } from "../../types/broker";
import type { InstrumentSearchResult } from "../../types/instrument";
import { buildIbkrConfigFromValues } from "../../plugins/ibkr/config";
import {
  getEmptyState,
  getRowPresentation,
  resolveCommandBarMode,
  truncateText,
} from "./view-model";

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
  quitApp: () => void;
}

interface ResultItem {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "theme" | "plugin" | "column" | "action" | "info";
  right?: string;
  themeId?: string; // for theme items — enables live preview
  pluginToggle?: () => void; // for plugin items — toggle with space
  secondaryAction?: () => void | Promise<void>;
  checked?: boolean;
  current?: boolean;
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
          onSubmit={() => {
            const submitted = value.trim() || step.defaultValue || "";
            if (submitted) resolve(submitted);
          }}
        />
      </box>
      {step.defaultValue && (
        <>
          <box height={1} />
          <text fg={colors.textMuted}>{`Press Enter to use ${step.defaultValue}`}</text>
        </>
      )}
    </box>
  );
}

function SelectStepContent({ resolve, step, dialogId }: PromptContext<string> & { step: WizardStep }) {
  const options = step.options ?? [];
  const [idx, setIdx] = useState(0);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setIdx((i) => Math.max(0, i - 1));
    else if (event.name === "down" || event.name === "j") setIdx((i) => Math.min(options.length - 1, i + 1));
    else if (event.name === "return") resolve(options[idx]?.value ?? "");
    else if (event.name === "escape") resolve("");
  }, dialogId);

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
      {options.map((option, optionIdx) => {
        const selected = optionIdx === idx;
        return (
          <box key={option.value} height={1} backgroundColor={selected ? colors.selected : colors.commandBg}>
            <text fg={selected ? colors.selectedText : colors.textDim}>
              {selected ? "\u25b8 " : "  "}
            </text>
            <text fg={selected ? colors.text : colors.textDim} attributes={selected ? TextAttributes.BOLD : 0}>
              {option.label}
            </text>
          </box>
        );
      })}
      <box height={1} />
      <text fg={colors.textMuted}>Use ↑↓ to choose · enter to select · esc to cancel</text>
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

export function CommandBar({ dataProvider, markdownStore, pluginRegistry, quitApp }: CommandBarProps) {
  const { state, dispatch } = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const { symbol: activeTickerSymbol, ticker: activeTickerData, financials: activeFinancials } = useFocusedTicker();
  const dialog = useDialog();
  const renderer = useRenderer();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchedQueryRef = useRef<string | null>(null);
  const searchRequestIdRef = useRef(0);
  const originalThemeRef = useRef<string>(getCurrentThemeId());
  const previousSelectionContextRef = useRef<{ query: string; mode: string } | null>(null);
  const query = state.commandBarQuery;

  const close = useCallback(() => {
    dispatch({ type: "SET_COMMAND_BAR", open: false });
    setResults([]);
    setSelectedIdx(0);
    setHoveredIdx(null);
  }, [dispatch]);

  // Revert theme on close without selection
  const closeAndRevert = useCallback(() => {
    dispatch({ type: "SET_THEME", theme: originalThemeRef.current });
    close();
  }, [dispatch, close]);

  const activeCollectionId = getFocusedCollectionId(state);
  const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId);

  const setActiveCollection = useCallback((collectionId: string) => {
    const currentState = stateRef.current;
    const resolvePortfolioPane = (candidate?: string | null): string | null => {
      if (!candidate) return null;
      const instance = findPaneInstance(currentState.config.layout, candidate);
      if (!instance) return null;
      if (instance.paneId === "portfolio-list") return instance.instanceId;
      if (instance.binding?.kind === "follow") return resolvePortfolioPane(instance.binding.sourceInstanceId);
      return null;
    };
    const targetPaneId = resolvePortfolioPane(currentState.focusedPaneId)
      ?? currentState.config.layout.instances.find((instance) => instance.paneId === "portfolio-list")?.instanceId
      ?? null;
    if (!targetPaneId) return;
    dispatch({ type: "UPDATE_PANE_STATE", paneId: targetPaneId, patch: { collectionId } });
  }, [dispatch]);

  const retargetDetailPane = useCallback((paneId: string, symbol: string) => {
    const currentState = stateRef.current;
    const targetPane = findPaneInstance(currentState.config.layout, paneId);
    if (!targetPane || targetPane.paneId !== "ticker-detail") return;

    const nextLayout = {
      ...currentState.config.layout,
      instances: currentState.config.layout.instances.map((instance) => (
        instance.instanceId === targetPane.instanceId
          ? { ...instance, title: symbol, binding: { kind: "fixed" as const, symbol } }
          : instance
      )),
    };
    const nextConfig = {
      ...currentState.config,
      layout: nextLayout,
      layouts: currentState.config.layouts.map((savedLayout, index) => (
        index === currentState.config.activeLayoutIndex ? { ...savedLayout, layout: nextLayout } : savedLayout
      )),
    };
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    saveConfig(nextConfig).catch(() => {});
    dispatch({ type: "FOCUS_PANE", paneId: targetPane.instanceId });
  }, [dispatch, pluginRegistry]);

  const openFixedTickerPane = useCallback((symbol: string) => {
    pluginRegistry.pinTickerFn(symbol, { floating: true, paneType: "ticker-detail" });
  }, [pluginRegistry]);

  const focusTicker = useCallback((symbol: string, options?: { forceNewPane?: boolean }) => {
    const currentState = stateRef.current;
    const focusedPane = currentState.focusedPaneId
      ? findPaneInstance(currentState.config.layout, currentState.focusedPaneId)
      : null;
    if (options?.forceNewPane) {
      openFixedTickerPane(symbol);
      return;
    }

    if (focusedPane?.paneId === "ticker-detail") {
      retargetDetailPane(focusedPane.instanceId, symbol);
      return;
    }

    openFixedTickerPane(symbol);
  }, [openFixedTickerPane, retargetDetailPane]);

  const connectBrokerProfile = useCallback(async (preselectedBrokerId?: string) => {
    let choiceId = preselectedBrokerId;
    if (!choiceId) {
      const choices: Array<{ id: string; label: string; desc: string }> = [];
      for (const [brokerId, adapter] of pluginRegistry.brokers) {
        if (adapter.configSchema.length > 0) {
          choices.push({
            id: brokerId,
            label: `Connect ${adapter.name}`,
            desc: `Create a new ${adapter.name} profile`,
          });
        }
      }
      if (choices.length === 0) return null;
      choiceId = await dialog.prompt<string>({
        content: (ctx) => <ChoiceContent {...ctx} title="Add Broker Account" choices={choices} />,
      });
      if (!choiceId) return null;
    }

    const adapter = [...pluginRegistry.brokers.values()].find((broker) => broker.id === choiceId);
    if (!adapter) return null;
    const profileLabel = await dialog.prompt<string>({
      content: (ctx) => <InputStepContent {...ctx} step={{
        key: "profileLabel",
        type: "text",
        label: "Broker Profile Label",
        body: ["Label this broker connection, for example Work, Personal, or Paper."],
        placeholder: "Work",
      }} />,
    });
    if (!profileLabel?.trim()) return null;

    const values: Record<string, string> = {};
    const prompted = new Set<string>();
    while (true) {
      const fields = resolveBrokerConfigFields(adapter, values).filter((field) => field.required);
      const nextField = fields.find((field) => !prompted.has(field.key));
      if (!nextField) break;

      const val = nextField.type === "select"
        ? await dialog.prompt<string>({
          content: (ctx) => <SelectStepContent {...ctx} step={{
            key: nextField.key,
            type: "select",
            label: nextField.label,
            options: nextField.options?.map((option) => ({ label: option.label, value: option.value })) ?? [],
            body: nextField.placeholder ? [nextField.placeholder] : [],
          }} />,
        })
        : await dialog.prompt<string>({
                  content: (ctx) => <InputStepContent {...ctx} step={{
                    key: nextField.key,
                    type: nextField.type === "password" ? "password" : nextField.type === "number" ? "number" : "text",
                    label: nextField.label,
                    body: nextField.placeholder ? [`${nextField.placeholder}`] : [],
                    defaultValue: nextField.defaultValue,
                    placeholder: nextField.placeholder || `Enter ${nextField.label.toLowerCase()}`,
                  }} />,
                });
      if (val === undefined || (nextField.type === "select" && !val)) return null;
      values[nextField.key] = val;
      prompted.add(nextField.key);
    }

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
      const brokerValues = choiceId === "ibkr"
        ? buildIbkrConfigFromValues(values)
        : values;
      const instance = await pluginRegistry.createBrokerInstanceFn(
        choiceId,
        profileLabel.trim(),
        brokerValues as Record<string, unknown>,
      );
      await pluginRegistry.syncBrokerInstanceFn(instance.id);
      dialog.close(dialogId);
      const freshConfig = pluginRegistry.getConfigFn();
      dispatch({ type: "SET_CONFIG", config: freshConfig });
      const brokerTab = freshConfig.portfolios.find((portfolio) => portfolio.brokerInstanceId === instance.id);
      if (brokerTab) setActiveCollection(brokerTab.id);
      await dialog.alert({
        content: (ctx) => <ResultContent {...ctx} message="Connected! Positions will sync automatically." isError={false} />,
      });
      return instance;
    } catch (err: any) {
      dialog.close(dialogId);
      await dialog.alert({
        content: (ctx) => <ResultContent {...ctx} message={err.message || "Connection failed"} isError={true} />,
      });
      return null;
    }
  }, [dialog, dispatch, pluginRegistry]);

  const pickBrokerInstance = useCallback(async (title: string, brokerType?: string) => {
    const instances = state.config.brokerInstances.filter((instance) => !brokerType || instance.brokerType === brokerType);
    if (instances.length === 0) return null;
    if (instances.length === 1) return instances[0]!;
    const selectedId = await dialog.prompt<string>({
      content: (ctx) => <ChoiceContent
        {...ctx}
        title={title}
        choices={instances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          desc: `${instance.brokerType.toUpperCase()} · ${instance.connectionMode || String(instance.config.connectionMode || "configured")}`,
        }))}
      />,
    });
    if (!selectedId) return null;
    return state.config.brokerInstances.find((instance) => instance.id === selectedId) ?? null;
  }, [dialog, state.config.brokerInstances]);

  // Handle prefix-based command execution
  const executeCommand = useCallback((cmd: Command, arg: string) => {
    const ctx = { activeTicker: activeTickerSymbol, activeCollectionId };

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
      case "add-broker-account": {
        close();
        void connectBrokerProfile();
        return;
      }
      case "disconnect-broker-account": {
        close();
        (async () => {
          const instance = await pickBrokerInstance("Disconnect Broker Account");
          if (!instance) return;
          const confirmed = await dialog.prompt<boolean>({
            content: (ctx) => <ConfirmContent
              {...ctx}
              title="Disconnect Broker Account"
              message={`Remove "${instance.label}" and all imported broker portfolios, positions, and contracts?`}
            />,
          });
          if (!confirmed) return;
          try {
            await pluginRegistry.removeBrokerInstanceFn(instance.id);
            const freshConfig = pluginRegistry.getConfigFn();
            dispatch({ type: "SET_CONFIG", config: freshConfig });
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={`Removed ${instance.label}.`} isError={false} />,
            });
          } catch (err: any) {
            await dialog.alert({
              content: (ctx) => <ResultContent {...ctx} message={err.message || "Disconnect failed"} isError={true} />,
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
            quitApp();
          }
        })();
        return;
      }
      case "columns": {
        // Enter columns mode by setting the prefix
        dispatch({ type: "SET_COMMAND_BAR_QUERY", query: "COL " });
        return;
      }
      case "add-watchlist":
      case "add-portfolio": {
        const ticker = activeTickerData;
        if (!ticker) return;
        const isWatchlist = cmd.id === "add-watchlist";
        const listId = isWatchlist
          ? (state.config.watchlists.some((w) => w.id === activeCollectionId)
            ? activeCollectionId
            : state.config.watchlists[0]?.id ?? null)
          : (state.config.portfolios.some((p) => p.id === activeCollectionId)
            ? activeCollectionId
            : state.config.portfolios.find((p) => !p.brokerId)?.id ?? null);
        if (!listId) return;
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
        const ticker = activeTickerData;
        if (!ticker) return;
        const isWatchlist = cmd.id === "remove-watchlist";
        const field = isWatchlist ? "watchlists" : "portfolios";
        const isMatchingTab = isWatchlist
          ? state.config.watchlists.some((w) => w.id === activeCollectionId)
          : state.config.portfolios.some((p) => p.id === activeCollectionId && !p.brokerId);
        if (isMatchingTab && activeCollectionId) {
          ticker.frontmatter[field] = ticker.frontmatter[field].filter((id) => id !== activeCollectionId);
        } else {
          const validIds = new Set(isWatchlist
            ? state.config.watchlists.map((w) => w.id)
            : state.config.portfolios.filter((p) => !p.brokerId).map((p) => p.id));
          ticker.frontmatter[field] = ticker.frontmatter[field].filter((id) => !validIds.has(id));
        }
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
            setActiveCollection(id);
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
            setActiveCollection(id);
            saveConfig(newConfig).catch(() => {});
          } else {
            await connectBrokerProfile(choiceId);
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
          if (activeCollectionId === choiceId) {
            const fallback = newConfig.portfolios[0]?.id || newConfig.watchlists[0]?.id || "";
            if (fallback) setActiveCollection(fallback);
          }
          saveConfig(newConfig).catch(() => {});
        })();
        return;
      }
      case "delete-portfolio": {
        close();
        (async () => {
          // Only show non-broker-managed portfolios for deletion
          const deletable = state.config.portfolios.filter((p) => !p.brokerId && !p.brokerInstanceId);
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
          if (activeCollectionId === choiceId) {
            const fallback = newConfig.portfolios[0]?.id || newConfig.watchlists[0]?.id || "";
            if (fallback) setActiveCollection(fallback);
          }
          saveConfig(newConfig).catch(() => {});
        })();
        return;
      }
      default:
        // Commands with hasArg are prefix-driven modes (theme, plugins, search)
        // — enter them by setting the query to their prefix instead of closing
        if (cmd.hasArg) {
          dispatch({ type: "SET_COMMAND_BAR_QUERY", query: cmd.prefix + " " });
          return;
        }
        cmd.execute(dispatch, ctx);
        close();
    }
  }, [state, dispatch, markdownStore, close, dialog, pluginRegistry]);

  const openTickerDetail = useCallback((result: InstrumentSearchResult, options?: { forceNewPane?: boolean }) => {
    (async () => {
      const symbol = result.brokerContract?.localSymbol || result.symbol.split(".")[0]!;
      let existing = await markdownStore.loadTicker(symbol);
      if (!existing) {
        const frontmatter: TickerFrontmatter = {
          ticker: symbol,
          exchange: result.exchange,
          currency: result.currency || result.brokerContract?.currency || "USD",
          name: result.name,
          assetCategory: result.brokerContract?.secType || result.type || undefined,
          broker_contracts: result.brokerContract ? [result.brokerContract] : [],
          portfolios: [],
          watchlists: [],
          positions: [],
          custom: {},
          tags: [],
        };
        existing = await markdownStore.createTicker(frontmatter);
      } else {
        existing.frontmatter.name = existing.frontmatter.name || result.name;
        existing.frontmatter.exchange = existing.frontmatter.exchange || result.exchange;
        existing.frontmatter.currency = existing.frontmatter.currency || result.currency || "USD";
        existing.frontmatter.assetCategory = existing.frontmatter.assetCategory || result.brokerContract?.secType || result.type || undefined;
        const existingContracts = existing.frontmatter.broker_contracts ?? [];
        if (result.brokerContract) {
          const nextContracts = [...existingContracts];
          const hasContract = nextContracts.some((contract) =>
            contract.brokerId === result.brokerContract!.brokerId
            && contract.brokerInstanceId === result.brokerContract!.brokerInstanceId
            && contract.conId === result.brokerContract!.conId
            && contract.localSymbol === result.brokerContract!.localSymbol,
          );
          if (!hasContract) nextContracts.push(result.brokerContract);
          existing.frontmatter.broker_contracts = nextContracts;
        }
        await markdownStore.saveTicker(existing);
      }
      dispatch({ type: "UPDATE_TICKER", ticker: existing });
      focusTicker(symbol, options);
      close();
    })();
  }, [markdownStore, dispatch, close, focusTicker]);

  // Run a wizard command through sequential dialogs
  const runWizard = useCallback(async (cmd: CommandDef) => {
    const steps = cmd.wizard!;
    const values: Record<string, string> = {};

    for (const step of steps) {
      if (step.dependsOn && values[step.dependsOn.key] !== step.dependsOn.value) {
        continue;
      }
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
            content: (ctx) => <ResultContent {...ctx} message={step.body?.[1] || "Done!"} isError={false} />,
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

      const result = step.type === "select"
        ? await dialog.prompt<string>({
          content: (ctx) => <SelectStepContent {...ctx} step={step} />,
        })
        : await dialog.prompt<string>({
          content: (ctx) => <InputStepContent {...ctx} step={step} />,
        });

      if (result === undefined || (step.type === "select" && !result)) return; // User cancelled
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
    const disabledPlugins = new Set(state.config.disabledPlugins || []);
    return [...pluginRegistry.commands.values()].filter((cmd) => {
      if (cmd.hidden?.()) return false;
      const pluginId = pluginRegistry.getCommandPluginId(cmd.id);
      if (pluginId && disabledPlugins.has(pluginId)) return false;
      return true;
    }).map((cmd) => {
      const pluginId = pluginRegistry.getCommandPluginId(cmd.id);
      const pluginName = pluginId ? pluginRegistry.allPlugins.get(pluginId)?.name : null;
      return {
        id: cmd.id,
        label: cmd.label,
        detail: cmd.description || "",
        category: pluginName || "Plugin Commands",
        kind: "command" as const,
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
      };
    });
  }, [pluginRegistry, close, runWizard, state.config.disabledPlugins]);

  const tickerActionItems = useCallback((): ResultItem[] => {
    const ticker = activeTickerData;
    const financials = activeFinancials;
    if (!ticker) return [];

    return [...pluginRegistry.tickerActions.values()]
      .filter((action) => !action.filter || action.filter(ticker))
      .map((action) => ({
        id: `ticker-action:${action.id}`,
        label: action.label,
        detail: ticker.frontmatter.ticker,
        category: "Actions",
        kind: "action" as const,
        action: () => {
          close();
          void action.execute(ticker, financials);
        },
      }));
  }, [pluginRegistry.tickerActions, activeTickerData, activeFinancials, close]);

  const activeMatch = matchPrefix(query);
  const modeInfo = resolveCommandBarMode(query);
  const isThemeMode = modeInfo.kind === "themes";
  const isPluginMode = modeInfo.kind === "plugins";
  const isColumnsMode = modeInfo.kind === "columns";

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

  useEffect(() => {
    const isWatchlistTab = state.config.watchlists.some((w) => w.id === activeCollectionId);
    const isPortfolioTab = state.config.portfolios.some((p) => p.id === activeCollectionId);
    const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId);
    const isBrokerManaged = !!activePortfolio?.brokerId;
    const activeTabName = isWatchlistTab
      ? state.config.watchlists.find((w) => w.id === activeCollectionId)?.name
      : state.config.portfolios.find((p) => p.id === activeCollectionId)?.name;
    const tickerData = activeTickerData;

    // Find a target watchlist/portfolio for add/remove commands, even when on a different tab type
    const targetWatchlistId = isWatchlistTab
      ? activeCollectionId
      : state.config.watchlists[0]?.id ?? null;
    const targetPortfolioId = isPortfolioTab
      ? activeCollectionId
      : state.config.portfolios.find((p) => !p.brokerId)?.id ?? null;

    function shouldShow(cmd: Command): boolean {
      switch (cmd.id) {
        case "add-watchlist":
          if (!tickerData || !targetWatchlistId) return false;
          return !tickerData.frontmatter.watchlists.includes(targetWatchlistId);
        case "remove-watchlist":
          if (!tickerData) return false;
          return tickerData.frontmatter.watchlists.length > 0;
        case "add-portfolio":
          if (!tickerData || !targetPortfolioId) return false;
          return !tickerData.frontmatter.portfolios.includes(targetPortfolioId);
        case "remove-portfolio":
          if (!tickerData) return false;
          return tickerData.frontmatter.portfolios.some((id) =>
            state.config.portfolios.some((p) => p.id === id && !p.brokerId));

        case "disconnect-broker-account":
          return state.config.brokerInstances.length > 0;
        default:
          return true;
      }
    }

    function smartLabel(cmd: Command): string {
      const sym = activeTickerSymbol;
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
        case "add-watchlist": {
          const name = state.config.watchlists.find((w) => w.id === targetWatchlistId)?.name;
          return name ? `in "${name}"` : cmd.description;
        }
        case "remove-watchlist": {
          const names = tickerData?.frontmatter.watchlists
            .map((id) => state.config.watchlists.find((w) => w.id === id)?.name)
            .filter(Boolean);
          return names?.length ? `from "${names.join(", ")}"` : cmd.description;
        }
        case "add-portfolio": {
          const name = state.config.portfolios.find((p) => p.id === targetPortfolioId)?.name;
          return name ? `in "${name}"` : cmd.description;
        }
        case "remove-portfolio": {
          const names = tickerData?.frontmatter.portfolios
            .map((id) => state.config.portfolios.find((p) => p.id === id && !p.brokerId)?.name)
            .filter(Boolean);
          return names?.length ? `from "${names.join(", ")}"` : cmd.description;
        }
        default:
          return cmd.description;
      }
    }

    function cmdToItem(cmd: Command): ResultItem | null {
      if (!shouldShow(cmd)) return null;
      return {
        id: cmd.id,
        label: smartLabel(cmd),
        detail: smartDetail(cmd),
        category: cmd.category,
        kind: "command",
        right: cmd.prefix || undefined,
        action: () => executeCommand(cmd, ""),
      };
    }

    const items: ResultItem[] = [];
    const match = matchPrefix(query);
    let initialIdx = 0;

    if (match && match.command.id === "plugins") {
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
          if (isEnabled) {
            for (const paneId of pluginRegistry.getPluginPaneIds(p.id)) {
              pluginRegistry.hideWidget(paneId);
            }
          }
          saveConfig({ ...state.config, disabledPlugins: newDisabled }).catch(() => {});
        };
        items.push({
          id: `plugin:${p.id}`,
          label: p.name,
          detail: p.description || "",
          category: "Plugins",
          kind: "plugin",
          checked: isEnabled,
          pluginToggle: toggleAction,
          action: toggleAction,
        });
      }
    } else if (match && match.command.id === "columns") {
      const activeIds = new Set(state.config.columns.map((c) => c.id));
      for (const col of ALL_COLUMNS) {
        const isOn = activeIds.has(col.id);
        items.push({
          id: `col:${col.id}`,
          label: col.label,
          detail: `${col.id} | w:${col.width} | ${col.align}`,
          right: col.format || "",
          category: "Columns",
          kind: "column",
          checked: isOn,
          action: () => toggleColumn(col.id),
        });
      }
    } else if (match && match.command.id === "theme") {
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
          category: "Themes",
          kind: "theme",
          current: isSaved,
          themeId: t.id,
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
        items.push({
          id: "hint",
          label: "Type a ticker symbol",
          detail: "Search Yahoo Finance and connected brokers",
          category: "Search",
          kind: "info",
          action: () => {},
        });
      }
    } else if (match && !match.command.hasArg) {
      if (shouldShow(match.command)) {
        items.push({
          id: match.command.id,
          label: smartLabel(match.command),
          detail: smartDetail(match.command),
          right: match.command.prefix || undefined,
          category: match.command.category,
          kind: "command",
          action: () => executeCommand(match.command, match.arg),
        });
      }
    } else if (!query) {
      const maxDefaultTickers = 5;
      const recentSymbols = state.recentTickers.slice(0, maxDefaultTickers);
      const recentTickers = recentSymbols
        .map((s) => state.tickers.get(s))
        .filter((t): t is TickerFile => t != null);
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
          kind: "ticker",
          secondaryAction: () => { focusTicker(t.frontmatter.ticker, { forceNewPane: true }); close(); },
          action: () => { focusTicker(t.frontmatter.ticker); close(); },
        });
      }
      for (const cmd of commands) {
        const item = cmdToItem(cmd);
        if (item) items.push(item);
      }
      items.push(...tickerActionItems());
      items.push(...pluginCommandItems());
    } else {
      const tickerItems: ResultItem[] = Array.from(state.tickers.values()).map((t) => ({
        id: `goto:${t.frontmatter.ticker}`,
        label: t.frontmatter.ticker,
        detail: t.frontmatter.name,
        category: "Tickers",
        kind: "ticker",
        secondaryAction: () => { focusTicker(t.frontmatter.ticker, { forceNewPane: true }); close(); },
        action: () => { focusTicker(t.frontmatter.ticker); close(); },
      }));
      const cmdItems = commands.map((cmd) => cmdToItem(cmd)).filter((item): item is ResultItem => item !== null);
      const allItems = [...tickerItems, ...cmdItems, ...tickerActionItems(), ...pluginCommandItems()];
      items.push(...fuzzyFilter(allItems, query, (i) => `${i.label} ${i.detail} ${i.right || ""}`));
    }

    setResults(items);
    setHoveredIdx((prev) => (prev != null && prev < items.length ? prev : null));
    const selectionContextChanged =
      previousSelectionContextRef.current?.query !== query
      || previousSelectionContextRef.current?.mode !== modeInfo.kind;

    if (match?.command.id === "columns" || match?.command.id === "plugins" || !selectionContextChanged) {
      setSelectedIdx((prev) => Math.max(0, Math.min(prev, items.length - 1)));
    } else {
      setSelectedIdx(initialIdx);
    }
    previousSelectionContextRef.current = { query, mode: modeInfo.kind };

    // Search providers only when in explicit ticker search mode (prefix "T")
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const isTPrefix = match?.command.id === "search-ticker" && match.arg.length >= 1;
    const searchQuery = isTPrefix ? match!.arg : query;
    const queryChanged = lastSearchedQueryRef.current !== searchQuery;
    if (isTPrefix && queryChanged) {
      lastSearchedQueryRef.current = searchQuery;
      setSearching(true);
      const requestId = ++searchRequestIdRef.current;
      searchTimerRef.current = setTimeout(async () => {
        try {
          const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId);
          const searchResults = await dataProvider.search(searchQuery, {
            preferBroker: true,
            brokerId: activePortfolio?.brokerId,
            brokerInstanceId: activePortfolio?.brokerInstanceId,
          });
          if (requestId !== searchRequestIdRef.current) return; // stale response
          const searchItems: ResultItem[] = searchResults
            .slice(0, 8)
            .map((r) => {
              const sym = r.brokerContract?.localSymbol || r.symbol.split(".")[0]!;
              const isExisting = state.tickers.has(sym);
              return {
                id: `search:${r.symbol}`,
                label: sym,
                detail: [r.name, r.brokerLabel, r.type || r.exchange].filter(Boolean).join(" | "),
                category: isExisting ? "Open" : "Search Results",
                kind: "search",
                secondaryAction: () => openTickerDetail(r, { forceNewPane: true }),
                action: () => openTickerDetail(r),
              };
            });
          setResults(searchItems.length > 0 ? searchItems : [{
              id: "no-results",
              label: `No matches for "${searchQuery}"`,
              detail: "Try a symbol, company name, or exchange variant",
              category: "Search",
              kind: "info",
              action: () => {},
            }]);
        } catch {
          if (requestId !== searchRequestIdRef.current) return; // stale error
          setResults([{
              id: "error",
              label: "Search failed",
              detail: "Check your connection",
              category: "Search",
              kind: "info",
              action: () => {},
            }]);
        } finally {
          if (requestId === searchRequestIdRef.current) setSearching(false);
        }
      }, 200);
    } else if (!isTPrefix) {
      setSearching(false);
      lastSearchedQueryRef.current = null;
    }

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, state.tickers, activeTickerSymbol, activeTickerData, activeCollectionId, state.config.watchlists, state.config.portfolios, state.config.brokerInstances, state.config.disabledPlugins, state.config.columns, toggleColumn, tickerActionItems, pluginCommandItems, focusTicker]);

  const exactTickerResult = (() => {
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery) return null;
    return results.find((item) =>
      (item.id.startsWith("goto:") || item.id.startsWith("search:"))
      && item.label.toUpperCase() === normalizedQuery,
    ) ?? null;
  })();

  // Live preview: apply theme as user arrows through the list
  useEffect(() => {
    if (!isThemeMode) return;
    const selected = results[selectedIdx];
    if (selected?.themeId && state.config.theme !== selected.themeId) {
      applyTheme(selected.themeId);
      dispatch({ type: "SET_THEME", theme: selected.themeId });
    }
  }, [selectedIdx, isThemeMode, results, state.config.theme, dispatch]);

  const setCommandBarQuery = useCallback((nextQuery: string) => {
    dispatch({ type: "SET_COMMAND_BAR_QUERY", query: nextQuery });
  }, [dispatch]);

  useEffect(() => {
    const handleKeyPress = (event: {
      name: string;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
      stopPropagation: () => void;
      preventDefault: () => void;
    }) => {
      setHoveredIdx(null);

      if (event.name === "escape" || event.name === "`") {
        event.stopPropagation();
        event.preventDefault();
        if (isThemeMode) {
          closeAndRevert();
        } else {
          close();
        }
        return;
      }

      if (event.name === "down" || (event.name === "n" && event.ctrl)) {
        event.stopPropagation();
        event.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
        return;
      }

      if (event.name === "up" || (event.name === "p" && event.ctrl)) {
        event.stopPropagation();
        event.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }

      if ((event.meta && (event.name === "backspace" || event.name === "delete")) || (event.ctrl && event.name === "u")) {
        event.stopPropagation();
        event.preventDefault();
        setCommandBarQuery("");
        return;
      }

      if ((event.ctrl && event.name === "w") || (event.meta && (event.name === "h" || event.name === "u"))) {
        event.stopPropagation();
        event.preventDefault();
        const trimmed = query.replace(/\s+$/, "");
        const nextQuery = trimmed.replace(/[^\s]+$/, "").replace(/\s+$/, "");
        setCommandBarQuery(nextQuery);
        return;
      }

      if (event.name === "space" && isPluginMode) {
        event.stopPropagation();
        event.preventDefault();
        const selected = results[selectedIdx];
        if (selected?.pluginToggle) selected.pluginToggle();
        return;
      }

      if (event.name === "space" && isColumnsMode) {
        event.stopPropagation();
        event.preventDefault();
        const selected = results[selectedIdx];
        if (selected) selected.action();
        return;
      }

      if (event.name === "return" || event.name === "enter") {
        event.stopPropagation();
        event.preventDefault();
        if (event.shift) {
          const selected = exactTickerResult?.secondaryAction ? exactTickerResult : results[selectedIdx];
          if (selected?.secondaryAction) {
            selected.secondaryAction();
          }
          return;
        }
        const selected = exactTickerResult ?? results[selectedIdx];
        if (selected) selected.action();
      }
    };

    renderer.keyInput.on("keypress", handleKeyPress);
    return () => {
      renderer.keyInput.off("keypress", handleKeyPress);
    };
  }, [close, closeAndRevert, exactTickerResult, isColumnsMode, isPluginMode, isThemeMode, query, renderer, results, selectedIdx, setCommandBarQuery]);

  const barWidth = Math.max(42, Math.min(64, termWidth - 8, Math.floor(termWidth * 0.62)));
  const isNarrow = barWidth < 52;
  const searchModeQuery = activeMatch?.command.id === "search-ticker" ? activeMatch.arg : "";
  const contentPadding = 3;
  const bodyHeight = Math.min(14, Math.max(8, termHeight - 10));
  const barHeight = bodyHeight + 5;
  const barLeft = Math.max(4, Math.floor((termWidth - barWidth) / 2));
  const barTop = Math.max(1, Math.floor((termHeight - barHeight) / 2));
  const paletteBg = commandBarBg();
  const paletteHeadingText = commandBarHeadingText();
  const paletteHoverBg = commandBarHoverBg();
  const paletteSelectedBg = commandBarSelectedBg();
  const paletteText = commandBarText();
  const paletteSubtleText = commandBarSubtleText();
  const paletteSelectedText = commandBarSelectedText();

  const allRows: Array<
    | { kind: "spacer"; id: string }
    | { kind: "heading"; id: string; label: string }
    | { kind: "item"; item: ResultItem; globalIdx: number }
    | { kind: "message"; id: string; label: string; dim?: boolean }
    | { kind: "spinner"; id: string; label: string }
    | { kind: "filler"; id: string }
  > = [];
  let previousCategory: string | null = null;
  for (let i = 0; i < results.length; i++) {
    const item = results[i]!;
    if (previousCategory !== null && item.category !== previousCategory) {
      allRows.push({
        kind: "spacer",
        id: `spacer:${i}:${item.category}`,
      });
    }
    if (item.category !== previousCategory) {
      allRows.push({
        kind: "heading",
        id: `heading:${i}:${item.category}`,
        label: item.category,
      });
    }
    previousCategory = item.category;
    allRows.push({ kind: "item", item, globalIdx: i });
  }
  const emptyState = getEmptyState(modeInfo.kind, query, searchModeQuery);
  const resultsInnerWidth = Math.max(12, barWidth - contentPadding * 2);
  const trailingWidth = isNarrow ? 0 : Math.max(8, Math.min(12, Math.floor(resultsInnerWidth * 0.18)));
  const labelWidth = Math.max(10, resultsInnerWidth - trailingWidth);
  const queryDisplayWidth = Math.max(8, barWidth - contentPadding * 2);

  let visibleRows: typeof allRows;
  if (searching) {
    visibleRows = [{ kind: "spinner", id: "searching", label: "Searching providers..." }];
  } else if (allRows.length === 0) {
    visibleRows = [{ kind: "message", id: "empty", label: emptyState.label }];
  } else {
    const selectedRowIdx = allRows.findIndex((row) => row.kind === "item" && row.globalIdx === selectedIdx);
    const halfWindow = Math.floor(bodyHeight / 2);
    let windowStart = Math.max(0, Math.min(selectedRowIdx - halfWindow, allRows.length - bodyHeight));
    if (windowStart < 0) windowStart = 0;
    visibleRows = allRows.slice(windowStart, windowStart + bodyHeight);
  }

  while (visibleRows.length < bodyHeight) {
    visibleRows.push({ kind: "filler", id: `filler:${visibleRows.length}` });
  }

  return (
    <box
      position="absolute"
      top={barTop}
      left={barLeft}
      width={barWidth}
      height={barHeight}
      flexDirection="column"
      backgroundColor={paletteBg}
      zIndex={100}
    >
      <box height={1} />

      <box height={1} paddingX={contentPadding} flexDirection="row">
        <box flexGrow={1}>
          <text fg={paletteText}>Commands</text>
        </box>
        <text fg={paletteSubtleText}>esc</text>
      </box>

      <box height={1} paddingX={contentPadding}>
        <input
          value={query}
          onInput={setCommandBarQuery}
          onChange={setCommandBarQuery}
          placeholder="Search"
          focused
          onSubmit={() => {
            const selected = exactTickerResult ?? results[selectedIdx];
            if (selected) selected.action();
          }}
          width={queryDisplayWidth}
          backgroundColor={paletteBg}
          focusedBackgroundColor={paletteBg}
          textColor={paletteText}
          focusedTextColor={paletteText}
          placeholderColor={paletteSubtleText}
          cursorColor={colors.textBright}
        />
      </box>

      <box height={1} />

      <box flexDirection="column" height={bodyHeight}>
        {visibleRows.map((row) => {
          if (row.kind === "filler") {
            return <box key={row.id} height={1} />;
          }

          if (row.kind === "spacer") {
            return <box key={row.id} height={1} />;
          }

          if (row.kind === "spinner") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding}>
                <Spinner label={row.label} />
              </box>
            );
          }

          if (row.kind === "message") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding}>
                <text fg={row.dim ? paletteSubtleText : paletteText}>{truncateText(row.label, barWidth - contentPadding * 2)}</text>
              </box>
            );
          }

          if (row.kind === "heading") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding}>
                <text attributes={TextAttributes.BOLD} fg={paletteHeadingText}>
                  {truncateText(row.label, barWidth - contentPadding * 2)}
                </text>
              </box>
            );
          }

          const isSel = row.globalIdx === selectedIdx;
          const isHovered = row.globalIdx === hoveredIdx && !isSel;
          const presentation = getRowPresentation(row.item, isSel, trailingWidth > 0);
          const label = truncateText(presentation.label, labelWidth);
          const trailing = truncateText(presentation.trailing, trailingWidth);

          return (
            <box
              key={row.item.id}
              flexDirection="row"
              height={1}
              paddingX={contentPadding}
              backgroundColor={isSel ? paletteSelectedBg : isHovered ? paletteHoverBg : paletteBg}
              onMouseMove={() => {
                setHoveredIdx((current) => (current === row.globalIdx ? current : row.globalIdx));
              }}
              onMouseDown={() => {
                setHoveredIdx(row.globalIdx);
                setSelectedIdx(row.globalIdx);
                row.item.action();
              }}
            >
              <box width={labelWidth}>
                <text fg={isSel ? paletteSelectedText : presentation.primaryMuted ? paletteSubtleText : paletteText}>
                  {label}
                </text>
              </box>
              {trailingWidth > 0 && (
                <box width={trailingWidth}>
                  <text fg={isSel ? paletteSelectedText : paletteSubtleText}>{trailing}</text>
                </box>
              )}
            </box>
          );
        })}
      </box>

      <box height={1} />
    </box>
  );
}
