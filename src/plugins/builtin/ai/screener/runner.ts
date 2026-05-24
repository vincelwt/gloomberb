import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { DataProvider } from "../../../../types/data-provider";
import type { TickerRecord } from "../../../../types/ticker";
import type { AppAction } from "../../../../core/state/app/types";
import { buildGloomberbCliInstructions, resolveGloomberbCliCommand } from "../gloomberb-cli";
import type { AiProvider } from "../providers";
import { getAiProvider } from "../providers";
import { isAiRunCancelled, runAiPrompt, type AiRunController } from "../runner";
import {
  buildScreenerPrompt,
  deriveScreenerTitle,
  getScreenerPromptSignature,
  mergeScreenerResults,
  parseScreenerResponse,
} from "./contract";
import type { AiScreenerTab, RunState } from "./model";
import { validateScreenerResults } from "./results";

interface UseAiScreenerRunnerOptions {
  dataProvider: DataProvider | null;
  dispatch: Dispatch<AppAction>;
  providers: AiProvider[];
  tabs: AiScreenerTab[];
  tickers: Map<string, TickerRecord>;
  clearForceConfirm: () => void;
  upsertTab: (tabId: string, updater: (tab: AiScreenerTab) => AiScreenerTab) => void;
}

export function useAiScreenerRunner({
  dataProvider,
  dispatch,
  providers,
  tabs,
  tickers,
  clearForceConfirm,
  upsertTab,
}: UseAiScreenerRunnerOptions) {
  const [runState, setRunState] = useState<RunState | null>(null);
  const runRef = useRef<AiRunController | null>(null);

  const cancelRun = useCallback(() => {
    runRef.current?.cancel();
    runRef.current = null;
    setRunState(null);
  }, []);

  const runTab = useCallback(async (tabId: string, mode: RunState["mode"]) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) return;

    const provider = getAiProvider(tab.providerId, providers);
    if (!provider) {
      upsertTab(tab.id, (current) => ({ ...current, lastError: "Unknown AI provider configured for this screener." }));
      return;
    }
    if (!provider.available) {
      upsertTab(tab.id, (current) => ({
        ...current,
        lastError: `${provider.name} is not installed or not available in PATH.`,
      }));
      return;
    }

    runRef.current?.cancel();
    clearForceConfirm();
    const samePrompt = tab.lastRunPromptSignature === getScreenerPromptSignature(tab.prompt, tab.providerId);
    const includePreviousResults = samePrompt && tab.results.length > 0;
    const startedAt = Date.now();
    const cliInstructions = buildGloomberbCliInstructions(resolveGloomberbCliCommand());
    const prompt = buildScreenerPrompt({
      currentDate: new Date(startedAt).toISOString().slice(0, 10),
      prompt: tab.prompt,
      provider,
      cliInstructions,
      previousResults: tab.results,
      includePreviousResults,
    });

    setRunState({ tabId: tab.id, mode, output: "" });
    upsertTab(tab.id, (current) => ({
      ...current,
      lastRunAt: startedAt,
      lastError: null,
      lastWarning: null,
    }));

    let rawOutput = "";
    try {
      const run = runAiPrompt({
        provider,
        prompt,
        onChunk: (output) => {
          setRunState((current) => (
            current?.tabId === tab.id
              ? { ...current, output }
              : current
          ));
        },
      });
      runRef.current = run;
      rawOutput = await run.done;

      const parsed = parseScreenerResponse(rawOutput);
      const validated = await validateScreenerResults(parsed.tickers, tickers, dispatch, dataProvider);
      const nextResults = !samePrompt || mode === "force"
        ? validated.results
        : mergeScreenerResults(tab.results, validated.results);

      upsertTab(tab.id, (current) => ({
        ...current,
        title: parsed.title || current.title || deriveScreenerTitle(current.prompt),
        summary: parsed.summary,
        results: nextResults,
        lastSuccessAt: startedAt,
        lastRunPromptSignature: getScreenerPromptSignature(current.prompt, current.providerId),
        lastError: null,
        lastWarning: validated.warning,
        debugOutput: null,
      }));
    } catch (error: unknown) {
      if (isAiRunCancelled(error)) return;
      upsertTab(tab.id, (current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : "AI screener failed.",
        debugOutput: rawOutput.trim() || current.debugOutput,
      }));
    } finally {
      if (runRef.current) {
        runRef.current = null;
      }
      setRunState((current) => (current?.tabId === tab.id ? null : current));
    }
  }, [clearForceConfirm, dataProvider, dispatch, providers, tabs, tickers, upsertTab]);

  useEffect(() => () => {
    runRef.current?.cancel();
  }, []);

  return {
    cancelRun,
    runState,
    runTab,
  };
}
