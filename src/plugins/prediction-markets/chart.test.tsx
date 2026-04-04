import { afterEach, describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, useEffect, useReducer, useRef } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";
import { getNativeSurfaceManager } from "../../components/chart/native/surface-manager";
import { PredictionMarketChart } from "./chart";

const TEST_PANE_ID = "prediction-scroll:test";
const SURFACE_ID = `chart-surface:${TEST_PANE_ID}:compact:base`;

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let scrollBoxRef: ScrollBoxRenderable | null = null;
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function ChartScrollHarness() {
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const config = createDefaultConfig("/tmp/gloomberb-test");
      config.chartPreferences.renderer = "kitty";
      const initial = createInitialState(config);
      initial.focusedPaneId = TEST_PANE_ID;
      return initial;
    })(),
  );
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    scrollBoxRef = scrollRef.current;
  });

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <scrollbox ref={scrollRef} height={10} scrollY>
          <box flexDirection="column">
            <box height={14}>
              <text>filler</text>
            </box>
            <PredictionMarketChart
              history={[
                { date: new Date("2026-04-01T00:00:00Z"), close: 0.45 },
                { date: new Date("2026-04-02T00:00:00Z"), close: 0.48 },
                { date: new Date("2026-04-03T00:00:00Z"), close: 0.51 },
                { date: new Date("2026-04-04T00:00:00Z"), close: 0.49 },
              ]}
              width={60}
              height={12}
              range="1M"
              onRangeSelect={() => {}}
            />
          </box>
        </scrollbox>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
      await testSetup!.renderOnce();
    });
  }
}

afterEach(() => {
  scrollBoxRef = null;
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PredictionMarketChart kitty scrolling", () => {
  test("creates a native chart surface when scrolled into view", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 100, height: 24 });
    (testSetup.renderer as { _capabilities: unknown })._capabilities = {
      kitty_graphics: true,
    };
    (testSetup.renderer as { _resolution: unknown })._resolution = {
      width: 1000,
      height: 720,
    };

    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(<ChartScrollHarness />);
    });

    await flushFrames();

    const manager = getNativeSurfaceManager(testSetup.renderer as never) as unknown as {
      surfaces: Map<
        string,
        {
          snapshot: {
            visibleRect: { x: number; y: number; width: number; height: number } | null;
          };
        }
      >;
    };

    const hiddenSurface = manager.surfaces.get(SURFACE_ID);
    expect(hiddenSurface).toBeUndefined();

    act(() => {
      scrollBoxRef!.scrollTop = 14;
    });

    await flushFrames();

    const visibleSurface = manager.surfaces.get(SURFACE_ID);
    expect(visibleSurface).toBeDefined();
    expect(visibleSurface?.snapshot.visibleRect).not.toBeNull();
    expect(testSetup.captureCharFrame()).toContain("1M");
  });
});
