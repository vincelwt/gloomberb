import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AppAction } from "../../../state/app/context";
import type { Command } from "../commands/registry";
import { resolveCommandBarMode } from "../view-model";
import type {
  CommandBarMainSnapshot,
  CommandBarRoute,
} from "../workflow/types";

interface UseCommandBarNavigationStateOptions {
  availableCommands: Command[];
  dispatch: Dispatch<AppAction>;
  initialQuery: string;
  restoreThemePreview: () => void;
}

interface CloseCommandBarOptions {
  revertThemePreview?: boolean;
}

interface UseCommandBarNavigationStateResult {
  closeAll: (options?: CloseCommandBarOptions) => void;
  currentRoute: CommandBarRoute | null;
  currentRouteRef: RefObject<CommandBarRoute | null>;
  dismissCommandBar: () => void;
  lastMainBrowseRef: RefObject<CommandBarMainSnapshot>;
  popRoute: () => void;
  pushRoute: (route: CommandBarRoute) => void;
  rootHoveredIdx: number | null;
  rootModeInfo: ReturnType<typeof resolveCommandBarMode>;
  rootModeKindRef: RefObject<ReturnType<typeof resolveCommandBarMode>["kind"]>;
  rootQuery: string;
  rootQueryRef: RefObject<string>;
  rootSelectedIdx: number;
  routeStack: CommandBarRoute[];
  setRootHoveredIdx: Dispatch<SetStateAction<number | null>>;
  setRootQuery: (query: string) => void;
  setRootSelectedIdx: Dispatch<SetStateAction<number>>;
  setRouteStack: Dispatch<SetStateAction<CommandBarRoute[]>>;
  updateTopRoute: (updater: (route: CommandBarRoute) => CommandBarRoute) => void;
}

export function useCommandBarNavigationState({
  availableCommands,
  dispatch,
  initialQuery,
  restoreThemePreview,
}: UseCommandBarNavigationStateOptions): UseCommandBarNavigationStateResult {
  const [rootQuery, setRootQueryValue] = useState(initialQuery);
  const rootQueryRef = useRef(rootQuery);
  rootQueryRef.current = rootQuery;

  const rootModeInfo = resolveCommandBarMode(rootQuery, availableCommands);
  const rootModeKindRef = useRef(rootModeInfo.kind);
  rootModeKindRef.current = rootModeInfo.kind;

  const [rootSelectedIdx, setRootSelectedIdx] = useState(0);
  const [rootHoveredIdx, setRootHoveredIdx] = useState<number | null>(null);
  const [routeStack, setRouteStack] = useState<CommandBarRoute[]>([]);
  const lastMainBrowseRef = useRef<CommandBarMainSnapshot>({ query: "", selectedIdx: 0 });

  const currentRoute = routeStack[routeStack.length - 1] ?? null;
  const currentRouteRef = useRef<CommandBarRoute | null>(currentRoute);
  currentRouteRef.current = currentRoute;

  const closeAll = useCallback((options?: CloseCommandBarOptions) => {
    if (options?.revertThemePreview !== false) {
      restoreThemePreview();
    }
    dispatch({ type: "SET_COMMAND_BAR", open: false });
    setRouteStack([]);
    setRootSelectedIdx(0);
    setRootHoveredIdx(null);
  }, [dispatch, restoreThemePreview]);

  const setRootQuery = useCallback((query: string) => {
    rootQueryRef.current = query;
    setRootQueryValue(query);
    dispatch({ type: "SET_COMMAND_BAR_QUERY", query });
  }, [dispatch]);

  const pushRoute = useCallback((route: CommandBarRoute) => {
    setRouteStack((current) => {
      if (current.length === 0) {
        return [{ ...route, restoreMain: lastMainBrowseRef.current }];
      }
      return [...current, route];
    });
  }, []);

  const updateTopRoute = useCallback((updater: (route: CommandBarRoute) => CommandBarRoute) => {
    setRouteStack((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const top = next[next.length - 1]!;
      const updated = updater(top);
      if (updated === top) return current;
      next[next.length - 1] = updated;
      return next;
    });
  }, []);

  const popRoute = useCallback(() => {
    if (!currentRoute) {
      closeAll();
      return;
    }

    if (routeStack.length === 1 && currentRoute.restoreMain) {
      setRootQuery(currentRoute.restoreMain.query);
      setRootSelectedIdx(currentRoute.restoreMain.selectedIdx);
      setRootHoveredIdx(null);
    }

    setRouteStack((current) => current.slice(0, -1));
  }, [closeAll, currentRoute, routeStack.length, setRootQuery]);

  const dismissCommandBar = useCallback(() => {
    if (currentRoute) {
      popRoute();
      return;
    }
    closeAll();
  }, [closeAll, currentRoute, popRoute]);

  return {
    closeAll,
    currentRoute,
    currentRouteRef,
    dismissCommandBar,
    lastMainBrowseRef,
    popRoute,
    pushRoute,
    rootHoveredIdx,
    rootModeInfo,
    rootModeKindRef,
    rootQuery,
    rootQueryRef,
    rootSelectedIdx,
    routeStack,
    setRootHoveredIdx,
    setRootQuery,
    setRootSelectedIdx,
    setRouteStack,
    updateTopRoute,
  };
}
