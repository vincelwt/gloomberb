import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import type { AppSessionSnapshot } from "../../core/state/session-persistence";
import {
  applyPredictionLaunchIntentToConfig,
  applyPredictionLaunchIntentToSessionSnapshot,
  parsePredictionLaunchArgs,
} from "./launch";

describe("prediction markets launch", () => {
  test("parses prediction launch args", () => {
    expect(parsePredictionLaunchArgs(["predictions"])).toEqual({
      venueScope: "all",
      categoryId: "all",
      browseTab: "top",
      searchQuery: "",
    });
    expect(parsePredictionLaunchArgs(["predictions", "world"])).toEqual({
      venueScope: "all",
      categoryId: "world",
      browseTab: "top",
      searchQuery: "",
    });
    expect(
      parsePredictionLaunchArgs([
        "predictions",
        "polymarket",
        "world",
        "ending",
        "iran",
      ]),
    ).toEqual({
      venueScope: "polymarket",
      categoryId: "world",
      browseTab: "ending",
      searchQuery: "iran",
    });
    expect(parsePredictionLaunchArgs(["ticker", "AAPL"])).toBeNull();
  });

  test("injects a prediction pane into the active layout when missing", () => {
    const config = createDefaultConfig("/tmp/gloomberb-launch-test");

    const result = applyPredictionLaunchIntentToConfig(
      config,
      {
        venueScope: "all",
        categoryId: "world",
        browseTab: "top",
        searchQuery: "iran",
      },
      { width: 140, height: 42 },
    );

    expect(
      result.config.layout.instances.some(
        (instance) =>
          instance.paneId === "prediction-markets" &&
          instance.instanceId === result.paneInstanceId,
      ),
    ).toBe(true);
    expect(
      result.config.layout.floating.some(
        (entry) => entry.instanceId === result.paneInstanceId,
      ),
    ).toBe(true);
    expect(
      result.config.layouts[result.config.activeLayoutIndex]?.layout.instances.some(
        (instance) => instance.instanceId === result.paneInstanceId,
      ),
    ).toBe(true);
  });

  test("seeds pane state and focus for prediction launch", () => {
    const config = createDefaultConfig("/tmp/gloomberb-launch-session-test");
    const launch = applyPredictionLaunchIntentToConfig(
      config,
      {
        venueScope: "polymarket",
        categoryId: "world",
        browseTab: "top",
        searchQuery: "iran",
      },
      { width: 140, height: 42 },
    );
    const snapshot: AppSessionSnapshot = {
      paneState: {},
      focusedPaneId: "portfolio-list:main",
      activePanel: "left",
      statusBarVisible: true,
      openPaneIds: ["portfolio-list:main"],
      hydrationTargets: [],
      exchangeCurrencies: [],
      savedAt: 1,
    };

    const seeded = applyPredictionLaunchIntentToSessionSnapshot(
      launch.config,
      snapshot,
      launch.paneInstanceId,
      {
        venueScope: "polymarket",
        categoryId: "world",
        browseTab: "top",
        searchQuery: "iran",
      },
    );

    expect(seeded.focusedPaneId).toBe(launch.paneInstanceId);
    expect(seeded.openPaneIds).toContain(launch.paneInstanceId);
    const pluginState = seeded.paneState[launch.paneInstanceId]?.pluginState as
      | Record<string, Record<string, unknown>>
      | undefined;

    expect(
      pluginState?.["prediction-markets"],
    ).toMatchObject({
      venueScope: "polymarket",
      categoryId: "world",
      browseTab: "top",
      searchQuery: "iran",
      selectedRowKey: null,
      selectedDetailMarketKey: null,
    });
  });
});
