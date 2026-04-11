import type { Dispatch } from "react";
import { type LayoutConfig, type PaneBinding, type PaneInstanceConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { Portfolio, TickerRecord, Watchlist } from "../../types/ticker";
import type { PaneSettingField, PaneTemplateContext, PaneTemplateCreateOptions, PaneTemplateInstanceConfig, PaneTemplateDef } from "../../types/plugin";
import { getFocusedCollectionId, getFocusedTickerSymbol, type AppAction, type AppState } from "../../state/app-context";
import type { PluginRegistry } from "../../plugins/registry";
import type { TickerRepository } from "../../data/ticker-repository";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "../../utils/ticker-search";
import { formatTickerListInput, parseTickerListInput } from "../../utils/ticker-list";
import { updatePaneInstance, setPaneSettings } from "../../pane-settings";
import { isManualPortfolio } from "../../plugins/builtin/portfolio-list/mutations";
import {
  buildComparisonChartPaneTitle,
  COMPARISON_CHART_PANE_ID,
} from "../../plugins/builtin/comparison-chart";
import { getPaneTemplateDisplayLabel } from "./pane-template-display";

export interface SharedWorkflowDeps {
  dataProvider: DataProvider;
  tickerRepository: TickerRepository;
  pluginRegistry: PluginRegistry;
  dispatch: Dispatch<AppAction>;
  getState: () => AppState;
}

interface CreatePaneTemplateDeps extends SharedWorkflowDeps {
  buildPaneInstance: (
    paneType: string,
    options?: {
      title?: string;
      binding?: PaneBinding;
      params?: Record<string, string>;
      settings?: Record<string, unknown>;
      instanceId?: string;
    },
  ) => PaneInstanceConfig | null;
  placePaneInstance: (
    instance: PaneInstanceConfig,
    paneDef: NonNullable<ReturnType<PluginRegistry["panes"]["get"]>>,
    options?: PaneTemplateInstanceConfig,
  ) => void;
}

interface ApplyPaneSettingDeps extends SharedWorkflowDeps {
  persistLayout: (layout: LayoutConfig, options?: { pushHistory?: boolean }) => void;
}

export type CollectionKind = "watchlist" | "portfolio";
export type CollectionMembershipAction = "add" | "remove";

export interface CollectionTargetOption {
  id: string;
  label: string;
  description?: string;
}

export interface ResolvedTickerInput {
  symbol: string;
  ticker: TickerRecord;
  created: boolean;
  source: "local" | "provider";
}

function getTickerSearchContext(state: AppState, collectionId: string | null) {
  const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === collectionId);
  return {
    preferBroker: true,
    brokerId: activePortfolio?.brokerId,
    brokerInstanceId: activePortfolio?.brokerInstanceId,
  };
}

async function materializeResolvedTicker(
  resolvedTicker: NonNullable<Awaited<ReturnType<typeof resolveTickerSearch>>>,
  deps: SharedWorkflowDeps,
): Promise<ResolvedTickerInput> {
  if (resolvedTicker.kind === "local") {
    return {
      symbol: resolvedTicker.ticker.metadata.ticker,
      ticker: resolvedTicker.ticker,
      created: false,
      source: "local",
    };
  }

  const { ticker, created } = await upsertTickerFromSearchResult(
    deps.tickerRepository,
    resolvedTicker.result,
  );
  deps.dispatch({ type: "UPDATE_TICKER", ticker });
  if (created) {
    deps.pluginRegistry.events.emit("ticker:added", {
      symbol: ticker.metadata.ticker,
      ticker,
    });
  }

  return {
    symbol: ticker.metadata.ticker,
    ticker,
    created,
    source: "provider",
  };
}

function getCollectionOptions(
  state: AppState,
  kind: CollectionKind,
): Array<Portfolio | Watchlist> {
  if (kind === "watchlist") {
    return state.config.watchlists;
  }
  return state.config.portfolios.filter(isManualPortfolio);
}

export function getCollectionTargetOptions(
  state: AppState,
  kind: CollectionKind,
  action: CollectionMembershipAction,
  ticker: TickerRecord | null,
): CollectionTargetOption[] {
  const collections = getCollectionOptions(state, kind);
  const membershipIds = ticker
    ? new Set(kind === "watchlist" ? ticker.metadata.watchlists : ticker.metadata.portfolios)
    : new Set<string>();

  return collections
    .filter((collection) => {
      if (!ticker) return true;
      const isMember = membershipIds.has(collection.id);
      return action === "add" ? !isMember : isMember;
    })
    .map((collection) => ({
      id: collection.id,
      label: collection.name,
      description: action === "add"
        ? `Add to "${collection.name}"`
        : `Remove from "${collection.name}"`,
    }));
}

export function resolvePreferredCollectionTarget(
  state: AppState,
  kind: CollectionKind,
  activeCollectionId: string | null,
  action: CollectionMembershipAction,
  ticker: TickerRecord | null,
): string | null {
  if (!activeCollectionId) return null;
  const options = getCollectionTargetOptions(state, kind, action, ticker);
  return options.some((option) => option.id === activeCollectionId) ? activeCollectionId : null;
}

export function resolveSoleCollectionTarget(
  state: AppState,
  kind: CollectionKind,
  action: CollectionMembershipAction,
  ticker: TickerRecord | null,
): string | null {
  const options = getCollectionTargetOptions(state, kind, action, ticker);
  return options.length === 1 ? options[0]!.id : null;
}

export async function resolveTickerInput(
  rawInput: string | undefined,
  activeTicker: string | null,
  collectionId: string | null,
  deps: SharedWorkflowDeps,
): Promise<ResolvedTickerInput | null> {
  const state = deps.getState();
  const resolvedTicker = await resolveTickerSearch({
    query: rawInput,
    activeTicker,
    tickers: state.tickers,
    dataProvider: deps.dataProvider,
    searchContext: getTickerSearchContext(state, collectionId),
  });
  if (!resolvedTicker) return null;
  return materializeResolvedTicker(resolvedTicker, deps);
}

export async function resolveTickerInputOrThrow(
  rawInput: string | undefined,
  activeTicker: string | null,
  collectionId: string | null,
  deps: SharedWorkflowDeps,
): Promise<ResolvedTickerInput> {
  const resolved = await resolveTickerInput(rawInput, activeTicker, collectionId, deps);
  if (!resolved) {
    throw new Error(`No ticker match found for "${rawInput ?? activeTicker ?? ""}".`);
  }
  return resolved;
}

export async function applyCollectionMembershipChange(
  ticker: TickerRecord,
  kind: CollectionKind,
  action: CollectionMembershipAction,
  collectionId: string,
  deps: SharedWorkflowDeps,
): Promise<{ changed: boolean; ticker: TickerRecord }> {
  const field = kind === "watchlist" ? "watchlists" : "portfolios";
  const currentValues = ticker.metadata[field];
  const nextValues = action === "add"
    ? (currentValues.includes(collectionId) ? currentValues : [...currentValues, collectionId])
    : currentValues.filter((entry) => entry !== collectionId);

  if (nextValues.length === currentValues.length && nextValues.every((entry, index) => entry === currentValues[index])) {
    return { changed: false, ticker };
  }

  const nextTicker: TickerRecord = {
    ...ticker,
    metadata: {
      ...ticker.metadata,
      [field]: nextValues,
    },
  };
  await deps.tickerRepository.saveTicker(nextTicker);
  deps.dispatch({ type: "UPDATE_TICKER", ticker: nextTicker });
  return { changed: true, ticker: nextTicker };
}

export async function resolveTickerListInput(
  rawInput: string,
  collectionId: string | null,
  deps: SharedWorkflowDeps,
): Promise<string[]> {
  const tokens = parseTickerListInput(rawInput);
  const symbols: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const resolvedTicker = await resolveTickerInputOrThrow(token, null, collectionId, deps);
    const symbol = resolvedTicker.symbol;

    if (seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }

  return symbols;
}

async function resolvePaneTemplateOptions(
  template: PaneTemplateDef,
  options: PaneTemplateCreateOptions | undefined,
  deps: SharedWorkflowDeps,
): Promise<{
  context: PaneTemplateContext;
  resolvedOptions: PaneTemplateCreateOptions | undefined;
}> {
  const state = deps.getState();
  const baseContext: PaneTemplateContext = {
    config: state.config,
    layout: state.config.layout,
    focusedPaneId: state.focusedPaneId,
    activeTicker: getFocusedTickerSymbol(state),
    activeCollectionId: getFocusedCollectionId(state),
  };

  let resolvedOptions = options;
  if (template.shortcut?.argPlaceholder === "ticker") {
    const resolvedTicker = await resolveTickerInputOrThrow(
      resolvedOptions?.arg,
      baseContext.activeTicker,
      baseContext.activeCollectionId,
      deps,
    );
    resolvedOptions = {
      ...resolvedOptions,
      symbol: resolvedTicker.symbol,
      ticker: resolvedTicker.ticker,
      searchResult: null,
    };
  } else if (template.shortcut?.argPlaceholder === "tickers") {
    const rawInput = resolvedOptions?.arg ?? resolvedOptions?.values?.tickers ?? "";
    const symbols = await resolveTickerListInput(rawInput, baseContext.activeCollectionId, deps);
    resolvedOptions = {
      ...resolvedOptions,
      arg: rawInput,
      symbols,
    };
  }

  const context: PaneTemplateContext = {
    ...baseContext,
    activeTicker: resolvedOptions?.symbol ?? baseContext.activeTicker,
  };

  return {
    context,
    resolvedOptions,
  };
}

export async function createPaneTemplateOrThrow(
  templateId: string,
  options: PaneTemplateCreateOptions | undefined,
  deps: CreatePaneTemplateDeps,
): Promise<void> {
  const template = deps.pluginRegistry.paneTemplates.get(templateId);
  if (!template) {
    throw new Error(`Unknown pane template "${templateId}".`);
  }

  const state = deps.getState();
  const pluginId = deps.pluginRegistry.getPaneTemplatePluginId(templateId);
  if (pluginId && state.config.disabledPlugins.includes(pluginId)) {
    throw new Error("Enable this plugin before creating its pane.");
  }

  const { context, resolvedOptions } = await resolvePaneTemplateOptions(template, options, deps);

  if (template.canCreate && !template.canCreate(context, resolvedOptions)) {
    throw new Error(`Can't create ${getPaneTemplateDisplayLabel(template).toLowerCase()} right now.`);
  }

  const createInstanceResult = await template.createInstance?.(context, resolvedOptions);
  if (createInstanceResult === null) {
    return;
  }
  const spec = createInstanceResult ?? {};

  const paneDef = deps.pluginRegistry.panes.get(template.paneId);
  if (!paneDef) {
    throw new Error(`Unknown pane "${template.paneId}".`);
  }

  const instance = deps.buildPaneInstance(template.paneId, {
    title: spec.title,
    binding: spec.binding,
    params: spec.params,
    settings: spec.settings,
  });
  if (!instance) {
    throw new Error("Open a matching ticker or collection context first.");
  }

  deps.placePaneInstance(instance, paneDef, spec);
}

export async function applyPaneSettingFieldValue(
  targetId: string,
  field: PaneSettingField,
  value: unknown,
  deps: ApplyPaneSettingDeps,
  options?: { pushHistory?: boolean },
): Promise<void> {
  const descriptor = deps.pluginRegistry.resolvePaneSettings(targetId);
  if (!descriptor) {
    throw new Error("This pane does not expose settings.");
  }

  const state = deps.getState();
  const shouldPushHistory = options?.pushHistory !== false;

  if (descriptor.pane.paneId === "quote-monitor" && field.key === "symbol") {
    const rawQuery = typeof value === "string" ? value.trim() : "";
    const resolvedTicker = await resolveTickerSearch({
      query: rawQuery,
      activeTicker: null,
      tickers: state.tickers,
      dataProvider: deps.dataProvider,
    });
    if (!resolvedTicker) {
      throw new Error(`No ticker match found for "${rawQuery}".`);
    }

    const symbol = resolvedTicker.kind === "local"
      ? resolvedTicker.ticker.metadata.ticker
      : resolvedTicker.symbol;

    if (resolvedTicker.kind === "provider") {
      const { ticker, created } = await upsertTickerFromSearchResult(
        deps.tickerRepository,
        resolvedTicker.result,
      );
      deps.dispatch({ type: "UPDATE_TICKER", ticker });
      if (created) {
        deps.pluginRegistry.events.emit("ticker:added", {
          symbol: ticker.metadata.ticker,
          ticker,
        });
      }
    }

    const nextLayout = updatePaneInstance(state.config.layout, targetId, (instance) => ({
      ...instance,
      title: symbol,
      binding: { kind: "fixed", symbol },
      settings: {
        ...(instance.settings ?? {}),
        symbol,
      },
    }));
    deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
    return;
  }

  if (descriptor.pane.paneId === COMPARISON_CHART_PANE_ID && field.key === "symbolsText") {
    const rawInput = typeof value === "string" ? value : "";
    const symbols = await resolveTickerListInput(
      rawInput,
      descriptor.context.activeCollectionId,
      deps,
    );
    const nextLayout = updatePaneInstance(state.config.layout, targetId, (instance) => ({
      ...instance,
      title: buildComparisonChartPaneTitle(symbols),
      settings: {
        ...(instance.settings ?? {}),
        symbols,
        symbolsText: formatTickerListInput(symbols),
      },
    }));
    deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
    return;
  }

  const nextSettings = {
    ...descriptor.context.settings,
    [field.key]: value,
  };

  if (descriptor.pane.paneId === "portfolio-list" && field.key === "hideTabs" && value === true) {
    const lockedCollectionId = typeof descriptor.context.paneState.collectionId === "string"
      ? descriptor.context.paneState.collectionId
      : descriptor.context.activeCollectionId;
    if (lockedCollectionId) {
      nextSettings.lockedCollectionId = lockedCollectionId;
    }
  }

  if (descriptor.pane.paneId === "ticker-detail" && field.key === "hideTabs" && value === true) {
    const lockedTabId = typeof descriptor.context.paneState.activeTabId === "string"
      ? descriptor.context.paneState.activeTabId
      : "overview";
    nextSettings.lockedTabId = lockedTabId;
  }

  const nextLayout = setPaneSettings(state.config.layout, targetId, nextSettings);
  deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
}
