import { useEffect, useRef } from "react";
import type { SessionStore } from "../data/session-store";
import {
  buildAppSessionSnapshot,
  type AppSessionSnapshot,
} from "./session-persistence";
import type { AppState } from "./app-context";

export function usePersistSessionSnapshot(
  sessionStore: SessionStore | undefined,
  state: AppState,
  sessionId: string,
  schemaVersion: number,
): void {
  const latestRef = useRef({
    sessionStore,
    state,
    sessionId,
    schemaVersion,
  });
  latestRef.current = {
    sessionStore,
    state,
    sessionId,
    schemaVersion,
  };

  const saveSnapshotRef = useRef<() => void>(() => {});
  saveSnapshotRef.current = () => {
    const {
      sessionStore: currentStore,
      state: currentState,
      sessionId: currentSessionId,
      schemaVersion: currentSchemaVersion,
    } = latestRef.current;

    if (!currentStore) return;
    if (!currentState.initialized && currentState.tickers.size === 0) return;

    try {
      currentStore.set(currentSessionId, buildAppSessionSnapshot({
        config: currentState.config,
        paneState: currentState.paneState,
        focusedPaneId: currentState.focusedPaneId,
        activePanel: currentState.activePanel,
        statusBarVisible: currentState.statusBarVisible,
        recentTickers: currentState.recentTickers,
        tickers: currentState.tickers,
        exchangeRates: currentState.exchangeRates,
      }) satisfies AppSessionSnapshot, currentSchemaVersion);
    } catch {
      // Snapshot persistence is best-effort during teardown.
    }
  };

  useEffect(() => {
    if (!sessionStore) return;
    if (!state.initialized && state.tickers.size === 0) return;
    const timer = setTimeout(() => {
      saveSnapshotRef.current();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [
    sessionStore,
    sessionId,
    schemaVersion,
    state.initialized,
    state.tickers,
    state.config,
    state.paneState,
    state.focusedPaneId,
    state.activePanel,
    state.statusBarVisible,
    state.recentTickers,
  ]);

  useEffect(() => {
    return () => {
      saveSnapshotRef.current();
    };
  }, []);
}
