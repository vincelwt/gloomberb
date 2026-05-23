import { dirname, resolve } from "path";
import { mkdir } from "fs/promises";
import type { PaneRuntimeState } from "../core/state/app-state";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { slugifyName } from "../utils/slugify";
import { renderDesktopPaneScreenshot, type DesktopPaneShotPayload } from "./desktop-pane-shot";
import { optionPaneState } from "./pane-function-options";
import type { ResolvedPaneFunction } from "./pane-function-resolver";
import type { MarketContext } from "./types";
import {
  collectShotSymbols,
  createFallbackTicker,
  fetchTickerFinancials,
  isFinancialAnalysisFunction,
  withShotPriceHistory,
} from "./pane-function-data";

const DESKTOP_CELL_WIDTH_PX = 8;
const DESKTOP_CELL_HEIGHT_PX = 18;

export function defaultScreenshotPath(resolved: ResolvedPaneFunction, rawArg: string): string {
  const suffix = slugifyName([resolved.token, rawArg].filter(Boolean).join("-"), "pane");
  return resolve(process.cwd(), `gloomberb-${suffix}.png`);
}

async function buildDesktopShotPayload(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
  rawArg: string,
  options: Record<string, string | true>,
  widthPx: number,
  heightPx: number,
): Promise<DesktopPaneShotPayload> {
  const widthCells = Math.max(1, Math.round(widthPx / DESKTOP_CELL_WIDTH_PX));
  const heightCells = Math.max(1, Math.round(heightPx / DESKTOP_CELL_HEIGHT_PX));
  const initialPaneState = optionPaneState(options);
  if (isFinancialAnalysisFunction(resolved) && !initialPaneState.activeTabId) {
    initialPaneState.activeTabId = "financials";
  }
  const paneState: Record<string, PaneRuntimeState> = {
    [resolved.instance.instanceId]: initialPaneState,
  };
  const layout = {
    dockRoot: null,
    instances: [resolved.instance],
    floating: [{
      instanceId: resolved.instance.instanceId,
      x: 0,
      y: 0,
      width: widthCells,
      height: heightCells,
      zIndex: 1,
    }],
    detached: [],
  };
  const config = {
    ...context.config,
    layout,
    layouts: [{
      name: "CLI Shot",
      layout,
      paneState,
      focusedPaneId: resolved.instance.instanceId,
      activePanel: "right" as const,
    }],
    activeLayoutIndex: 0,
    onboardingComplete: true,
  };

  const tickers: TickerRecord[] = [];
  const financials: Array<[string, TickerFinancials]> = [];
  for (const symbol of collectShotSymbols(resolved, rawArg)) {
    const entry = await fetchTickerFinancials(context, symbol);
    const data = await withShotPriceHistory(context, symbol, entry.tickerFile, entry.financials);
    tickers.push(entry.tickerFile ?? createFallbackTicker(symbol, data, context));
    financials.push([symbol, data]);
  }

  return {
    config,
    paneId: resolved.instance.instanceId,
    widthCells,
    heightCells,
    widthPx,
    heightPx,
    tickers,
    financials,
    paneState,
  };
}

export async function renderDesktopShot({
  resolved,
  context,
  rawArg,
  outputPath,
  width,
  height,
  options,
}: {
  resolved: ResolvedPaneFunction;
  context: MarketContext;
  rawArg: string;
  outputPath: string;
  width: number;
  height: number;
  options: Record<string, string | true>;
}): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const payload = await buildDesktopShotPayload(resolved, context, rawArg, options, width, height);
  await renderDesktopPaneScreenshot(payload, outputPath);
}
