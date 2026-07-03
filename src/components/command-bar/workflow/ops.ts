import { type LayoutConfig, type PaneBinding, type PaneInstanceConfig } from "../../../types/config";
import type { PaneSettingField, PaneTemplateContext, PaneTemplateCreateOptions, PaneTemplateInstanceConfig, PaneTemplateDef } from "../../../types/plugin";
import { getFocusedCollectionId, getFocusedTickerSymbol } from "../../../state/app/context";
import type { PluginRegistry } from "../../../plugins/registry";
import { formatTickerListInput } from "../../../tickers/list";
import { updatePaneInstance, setPaneSettings } from "../../../pane-settings";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { cleanPortfolioPaneSettings, resolvePortfolioPaneCollectionId } from "../../../plugins/builtin/portfolio-list/settings";
import {
  DEFAULT_RELATIONSHIP_SECOND_SYMBOL,
  RELATIONSHIP_GRAPH_PANE_ID,
  buildRelationshipGraphPaneTitle,
} from "../../../plugins/builtin/correlation/relationship/model";
import {
  buildComparisonChartPaneTitle,
  COMPARISON_CHART_PANE_ID,
  MIN_COMPARISON_CHART_SYMBOLS,
} from "../../../plugins/builtin/comparison-chart";
import {
  FUNDAMENTAL_GRAPH_PANE_ID,
  graphKindFromSettings,
  graphShortcutForKind,
  graphTemplateTitle,
} from "../../../plugins/builtin/ticker-detail/data-panes/fundamental-graph/settings";
import { buildQuoteMonitorPaneTitle } from "../../../plugins/builtin/ticker-detail/settings";
import { getPaneTemplateDisplayLabel } from "../pane-templates/items";
import {
  resolveTickerInputOrThrow,
  resolveTickerListInput,
  type SharedWorkflowDeps,
} from "./tickers";

export {
  applyCollectionMembershipChange,
  getCollectionTargetOptions,
  resolvePreferredCollectionTarget,
  resolveSoleCollectionTarget,
  resolveTickerInput,
  resolveTickerInputOrThrow,
  resolveTickerListInput,
  type CollectionKind,
  type CollectionMembershipAction,
  type SharedWorkflowDeps,
} from "./tickers";

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

function updateTickerListPane(
  layout: LayoutConfig,
  targetId: string,
  options: {
    title: string;
    symbols: readonly string[];
    primarySymbol?: string;
    settings?: Record<string, unknown>;
  },
): LayoutConfig {
  const symbols = [...options.symbols];
  return updatePaneInstance(layout, targetId, (instance) => ({
    ...instance,
    title: options.title,
    ...(options.primarySymbol ? { binding: { kind: "fixed", symbol: options.primarySymbol } as PaneBinding } : {}),
    settings: {
      ...(instance.settings ?? {}),
      symbols,
      symbolsText: formatTickerListInput(symbols),
      ...(options.settings ?? {}),
    },
  }));
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
    instanceId: spec.instanceId,
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

  if (field.storage === "plugin") {
    if (!descriptor.pluginId) {
      throw new Error("This pane setting is not owned by a plugin.");
    }
    await deps.pluginRegistry.setConfigState(descriptor.pluginId, field.key, value);
    return;
  }

  if (descriptor.pane.paneId === "quote-monitor" && (field.key === "symbol" || field.key === "symbolsText")) {
    const rawQuery = typeof value === "string" ? value.trim() : "";
    const symbols = await resolveTickerListInput(rawQuery, null, deps);
    const primarySymbol = symbols[0]!;
    const nextLayout = updateTickerListPane(state.config.layout, targetId, {
      title: buildQuoteMonitorPaneTitle(symbols),
      symbols,
      primarySymbol,
      settings: { symbol: primarySymbol },
    });
    deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
    return;
  }

  if (descriptor.pane.paneId === FUNDAMENTAL_GRAPH_PANE_ID && field.key === "symbolsText") {
    const rawInput = typeof value === "string" ? value : "";
    const symbols = await resolveTickerListInput(
      rawInput,
      descriptor.context.activeCollectionId,
      deps,
    );
    const primarySymbol = symbols[0]!;
    const chartKind = graphKindFromSettings(descriptor.context.settings, "fundamental");
    const nextLayout = updateTickerListPane(state.config.layout, targetId, {
      title: graphTemplateTitle(graphShortcutForKind(chartKind), symbols),
      symbols,
      primarySymbol,
    });
    deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
    return;
  }

  if (descriptor.pane.paneId === RELATIONSHIP_GRAPH_PANE_ID && field.key === "symbolsText") {
    const rawInput = typeof value === "string" ? value : "";
    const symbols = await resolveTickerListInput(
      rawInput,
      descriptor.context.activeCollectionId,
      deps,
    );
    if (symbols.length > 2) {
      throw new Error("Enter one or two tickers.");
    }
    const pair: [string, string] = [symbols[0]!, symbols[1] ?? DEFAULT_RELATIONSHIP_SECOND_SYMBOL];
    const nextLayout = updateTickerListPane(state.config.layout, targetId, {
      title: buildRelationshipGraphPaneTitle(pair),
      symbols: pair,
      primarySymbol: pair[0],
    });
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
    if (symbols.length < MIN_COMPARISON_CHART_SYMBOLS) {
      throw new Error(`Enter at least ${MIN_COMPARISON_CHART_SYMBOLS} tickers.`);
    }
    const nextLayout = updateTickerListPane(state.config.layout, targetId, {
      title: buildComparisonChartPaneTitle(symbols),
      symbols,
    });
    deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
    return;
  }

  let nextSettings: Record<string, unknown> = {
    ...(descriptor.rawSettings ?? descriptor.context.settings),
    [field.key]: value,
  };

  if (descriptor.pane.paneId === "portfolio-list") {
    nextSettings = cleanPortfolioPaneSettings(nextSettings);
  }

  if (descriptor.pane.paneId === TICKER_RESEARCH_PANE_ID && field.key === "hideTabs" && value === true) {
    const lockedTabId = typeof descriptor.context.paneState.activeTabId === "string"
      ? descriptor.context.paneState.activeTabId
      : "overview";
    nextSettings.lockedTabId = lockedTabId;
  }

  let nextLayout = setPaneSettings(state.config.layout, targetId, nextSettings);

  if (descriptor.pane.paneId === "portfolio-list") {
    const currentCollectionId = typeof descriptor.context.paneState.collectionId === "string"
      ? descriptor.context.paneState.collectionId
      : (descriptor.context.activeCollectionId ?? "");
    const displayedCollectionId = resolvePortfolioPaneCollectionId(
      state.config,
      descriptor.context.settings,
      currentCollectionId,
    );
    const nextCollectionId = resolvePortfolioPaneCollectionId(
      state.config,
      nextSettings,
      displayedCollectionId || currentCollectionId,
    );
    if (nextCollectionId) {
      nextLayout = updatePaneInstance(nextLayout, targetId, (instance) => ({
        ...instance,
        params: {
          ...(instance.params ?? {}),
          collectionId: nextCollectionId,
        },
      }));
      deps.dispatch({ type: "UPDATE_PANE_STATE", paneId: targetId, patch: { collectionId: nextCollectionId } });
    }
  }

  deps.persistLayout(nextLayout, { pushHistory: shouldPushHistory });
}
