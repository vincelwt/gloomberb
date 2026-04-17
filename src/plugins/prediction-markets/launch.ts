import type { ReactNode } from "react";
import { getDockedPaneIds, addPaneFloating, bringToFront, isPaneInLayout } from "../pane-manager";
import {
  cloneLayout,
  createPaneInstance,
  findPaneInstance,
  type AppConfig,
  type SavedLayout,
} from "../../types/config";
import type { CliLaunchRequest, PaneDef } from "../../types/plugin";
import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import { PREDICTION_CATEGORY_OPTIONS, type PredictionCategoryId } from "./categories";
import { BROWSE_TABS } from "./navigation";
import type { PredictionBrowseTab, PredictionVenueScope } from "./types";

const PREDICTION_PANE_ID = "prediction-markets";
const PREDICTION_MAIN_INSTANCE_ID = `${PREDICTION_PANE_ID}:main`;

const VENUE_SCOPE_SET = new Set<PredictionVenueScope>([
  "all",
  "polymarket",
  "kalshi",
]);
const CATEGORY_ID_SET = new Set<PredictionCategoryId>(
  PREDICTION_CATEGORY_OPTIONS.map((option) => option.id),
);
const BROWSE_TAB_SET = new Set<PredictionBrowseTab>(
  BROWSE_TABS.map((tab) => tab.value),
);

const PREDICTION_FLOATING_PANE_DEF: PaneDef = {
  id: PREDICTION_PANE_ID,
  name: "Prediction Markets",
  component: () => null as ReactNode,
  defaultPosition: "left",
  defaultMode: "floating",
  defaultFloatingSize: { width: 132, height: 36 },
};

export interface PredictionLaunchIntent {
  venueScope: PredictionVenueScope;
  categoryId: PredictionCategoryId;
  browseTab: PredictionBrowseTab;
  searchQuery: string;
}

function normalizeArg(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePredictionCommandArgs(args: string[]): PredictionLaunchIntent {
  let venueScope: PredictionVenueScope = "all";
  let categoryId: PredictionCategoryId = "all";
  let browseTab: PredictionBrowseTab = "top";
  let venueExplicit = false;
  let categoryExplicit = false;
  let browseExplicit = false;
  const searchTokens: string[] = [];

  for (const arg of args) {
    const normalized = normalizeArg(arg);
    if (!normalized) continue;

    if (!venueExplicit && VENUE_SCOPE_SET.has(normalized as PredictionVenueScope)) {
      venueScope = normalized as PredictionVenueScope;
      venueExplicit = true;
      continue;
    }
    if (!categoryExplicit && CATEGORY_ID_SET.has(normalized as PredictionCategoryId)) {
      categoryId = normalized as PredictionCategoryId;
      categoryExplicit = true;
      continue;
    }
    if (!browseExplicit && BROWSE_TAB_SET.has(normalized as PredictionBrowseTab)) {
      browseTab = normalized as PredictionBrowseTab;
      browseExplicit = true;
      continue;
    }
    searchTokens.push(arg);
  }

  return {
    venueScope,
    categoryId,
    browseTab,
    searchQuery: searchTokens.join(" ").trim(),
  };
}

export function parsePredictionLaunchArgs(
  args: string[],
): PredictionLaunchIntent | null {
  const [command, ...rest] = args;
  if (!command) return null;
  const normalizedCommand = normalizeArg(command);
  if (
    normalizedCommand !== "predictions" &&
    normalizedCommand !== "prediction-markets" &&
    normalizedCommand !== "pm"
  ) {
    return null;
  }

  return parsePredictionCommandArgs(rest);
}

function syncActiveLayout(
  layouts: SavedLayout[],
  activeLayoutIndex: number,
  nextLayout: AppConfig["layout"],
): SavedLayout[] {
  return layouts.map((entry, index) => (
    index === activeLayoutIndex
      ? { ...entry, layout: cloneLayout(nextLayout) }
      : { ...entry, layout: cloneLayout(entry.layout) }
  ));
}

export function applyPredictionLaunchIntentToConfig(
  config: AppConfig,
  intent: PredictionLaunchIntent,
  terminalSize: { width: number; height: number },
): { config: AppConfig; paneInstanceId: string } {
  let nextLayout = cloneLayout(config.layout);
  let targetInstance =
    nextLayout.instances.find((instance) => instance.paneId === PREDICTION_PANE_ID) ??
    null;

  if (!targetInstance) {
    targetInstance = createPaneInstance(PREDICTION_PANE_ID, {
      instanceId: PREDICTION_MAIN_INSTANCE_ID,
      params: {
        scope: intent.venueScope,
        category: intent.categoryId,
        browseTab: intent.browseTab,
        query: intent.searchQuery,
      },
    });
    nextLayout = addPaneFloating(
      nextLayout,
      targetInstance,
      terminalSize.width,
      terminalSize.height,
      PREDICTION_FLOATING_PANE_DEF,
    );
  } else {
    nextLayout = {
      ...nextLayout,
      instances: nextLayout.instances.map((instance) => (
        instance.instanceId === targetInstance!.instanceId
          ? {
              ...instance,
              params: {
                ...(instance.params ?? {}),
                scope: intent.venueScope,
                category: intent.categoryId,
                browseTab: intent.browseTab,
                query: intent.searchQuery,
              },
            }
          : instance
      )),
    };
    targetInstance =
      findPaneInstance(nextLayout, targetInstance.instanceId) ?? targetInstance;
    if (!targetInstance) {
      throw new Error("Prediction launch target pane could not be resolved.");
    }
    const targetInstanceId = targetInstance.instanceId;
    if (!isPaneInLayout(nextLayout, targetInstanceId)) {
      nextLayout = addPaneFloating(
        nextLayout,
        targetInstance,
        terminalSize.width,
        terminalSize.height,
        PREDICTION_FLOATING_PANE_DEF,
      );
    } else if (
      nextLayout.floating.some((entry) => entry.instanceId === targetInstanceId)
    ) {
      nextLayout = bringToFront(nextLayout, targetInstanceId);
    }
  }

  if (!targetInstance) {
    throw new Error("Prediction launch target pane could not be resolved.");
  }

  return {
    config: {
      ...config,
      layout: nextLayout,
      layouts: syncActiveLayout(config.layouts, config.activeLayoutIndex, nextLayout),
    },
    paneInstanceId: targetInstance.instanceId,
  };
}

export function applyPredictionLaunchIntentToSessionSnapshot(
  config: AppConfig,
  sessionSnapshot: AppSessionSnapshot | null,
  paneInstanceId: string,
  intent: PredictionLaunchIntent,
): AppSessionSnapshot {
  const currentPaneState = sessionSnapshot?.paneState?.[paneInstanceId] ?? {};
  const currentPluginState =
    (currentPaneState.pluginState as Record<string, Record<string, unknown>> | undefined) ??
    {};
  const currentPredictionState = currentPluginState[PREDICTION_PANE_ID] ?? {};

  return {
    paneState: {
      ...(sessionSnapshot?.paneState ?? {}),
      [paneInstanceId]: {
        ...currentPaneState,
        pluginState: {
          ...currentPluginState,
          [PREDICTION_PANE_ID]: {
            ...currentPredictionState,
            venueScope: intent.venueScope,
            categoryId: intent.categoryId,
            browseTab: intent.browseTab,
            searchQuery: intent.searchQuery,
            selectedRowKey: null,
            selectedDetailMarketKey: null,
          },
        },
      },
    },
    focusedPaneId: paneInstanceId,
    activePanel: sessionSnapshot?.activePanel === "right" ? "right" : "left",
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
    openPaneIds: [
      ...new Set([
        ...(sessionSnapshot?.openPaneIds ?? []),
        ...getDockedPaneIds(config.layout),
        ...config.layout.floating.map((entry) => entry.instanceId),
      ]),
    ],
    hydrationTargets: [...(sessionSnapshot?.hydrationTargets ?? [])],
    exchangeCurrencies: [...(sessionSnapshot?.exchangeCurrencies ?? [])],
    savedAt: Date.now(),
  };
}

export function createPredictionLaunchRequest(
  intent: PredictionLaunchIntent,
): CliLaunchRequest<{ paneInstanceId: string; intent: PredictionLaunchIntent }> {
  return {
    applyConfig(config, env) {
      const result = applyPredictionLaunchIntentToConfig(config, intent, {
        width: Math.max(env.terminalWidth, 120),
        height: Math.max(env.terminalHeight, 40),
      });
      return {
        config: result.config,
        launchState: {
          paneInstanceId: result.paneInstanceId,
          intent,
        },
      };
    },
    applySessionSnapshot(config, snapshot, launchState) {
      if (!launchState) {
        return applyPredictionLaunchIntentToSessionSnapshot(config, snapshot, PREDICTION_MAIN_INSTANCE_ID, intent);
      }
      return applyPredictionLaunchIntentToSessionSnapshot(
        config,
        snapshot,
        launchState.paneInstanceId,
        launchState.intent,
      );
    },
  };
}
