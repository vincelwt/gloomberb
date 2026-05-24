import { useEffect, useRef, type MutableRefObject } from "react";
import type { DataProvider } from "../../../types/data-provider";
import { useAlertWorkflowQuoteSync } from "../workflow/alert";
import type { CommandBarRoute, CommandBarWorkflowRoute } from "../workflow/types";

interface CommandBarMainBrowseState {
  query: string;
  selectedIdx: number;
}

interface CommandBarRouteEffectsOptions {
  clearThemePreview: (themeId: string | null | undefined) => void;
  committedThemeId: string;
  currentRoute: CommandBarRoute | null;
  dataProvider: DataProvider;
  ensureRouteFieldFocus: (route: CommandBarWorkflowRoute) => void;
  lastMainBrowseRef: MutableRefObject<CommandBarMainBrowseState>;
  rootModeKind: string;
  rootQuery: string;
  rootSelectedIdx: number;
  rootThemeBaseIdRef: MutableRefObject<string | null>;
  updateTopRoute: (updater: (route: CommandBarRoute) => CommandBarRoute) => void;
}

export function useCommandBarRouteEffects({
  clearThemePreview,
  committedThemeId,
  currentRoute,
  dataProvider,
  ensureRouteFieldFocus,
  lastMainBrowseRef,
  rootModeKind,
  rootQuery,
  rootSelectedIdx,
  rootThemeBaseIdRef,
  updateTopRoute,
}: CommandBarRouteEffectsOptions): void {
  const previousRootModeRef = useRef(rootModeKind);

  useEffect(() => {
    if (!currentRoute) {
      lastMainBrowseRef.current = {
        query: rootQuery,
        selectedIdx: rootSelectedIdx,
      };
    }
  }, [currentRoute, lastMainBrowseRef, rootQuery, rootSelectedIdx]);

  useEffect(() => {
    if (currentRoute) return;

    const previousMode = previousRootModeRef.current;
    if (rootModeKind === "themes" && (previousMode !== "themes" || !rootThemeBaseIdRef.current)) {
      rootThemeBaseIdRef.current = committedThemeId;
    } else if (rootModeKind !== "themes" && previousMode === "themes") {
      const rootThemeBaseId = rootThemeBaseIdRef.current;
      if (rootThemeBaseId) {
        clearThemePreview(rootThemeBaseId);
      }
      rootThemeBaseIdRef.current = null;
    }
    previousRootModeRef.current = rootModeKind;
  }, [
    clearThemePreview,
    committedThemeId,
    currentRoute,
    previousRootModeRef,
    rootModeKind,
    rootThemeBaseIdRef,
  ]);

  useEffect(() => {
    if (currentRoute?.kind !== "workflow") return;
    ensureRouteFieldFocus(currentRoute);
  }, [currentRoute, ensureRouteFieldFocus]);

  useAlertWorkflowQuoteSync({
    dataProvider,
    route: currentRoute,
    updateTopRoute,
  });
}
