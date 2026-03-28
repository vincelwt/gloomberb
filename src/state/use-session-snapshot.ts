import { useEffect } from "react";
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
  useEffect(() => {
    if (!sessionStore) return;
    if (!state.initialized && state.tickers.size === 0) return;

    const saveSnapshot = () => {
      try {
        sessionStore.set(sessionId, buildAppSessionSnapshot({
          config: state.config,
          paneState: state.paneState,
          focusedPaneId: state.focusedPaneId,
          activePanel: state.activePanel,
          statusBarVisible: state.statusBarVisible,
          recentTickers: state.recentTickers,
          tickers: state.tickers,
          financials: state.financials,
          exchangeRates: state.exchangeRates,
        }) satisfies AppSessionSnapshot, schemaVersion);
      } catch {
        // Snapshot persistence is best-effort during teardown.
      }
    };

    const timer = setTimeout(saveSnapshot, 250);
    return () => {
      clearTimeout(timer);
      saveSnapshot();
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
    state.financials,
    state.exchangeRates,
  ]);
}
