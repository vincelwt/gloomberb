import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";
import { ChartSurface, Text } from "../../ui";
import { getNativeSurfaceManager } from "../../components/chart/native/surface/manager";
import type { ChartRendererPreference } from "../../components/chart/core/types";
import { AppProvider } from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { createOpenTuiTestRoot } from "./test-utils";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createOpenTuiTestRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const bitmap = {
  width: 4,
  height: 4,
  pixels: new Uint8Array(4 * 4 * 4).fill(255),
};

function setNativeRendererReady(): void {
  (testSetup!.renderer as { _capabilities: unknown })._capabilities = { kitty_graphics: true };
  (testSetup!.renderer as { _resolution: unknown })._resolution = { width: 800, height: 400 };
}

function surfaceCount(): number {
  const manager = getNativeSurfaceManager(testSetup!.renderer as never) as unknown as {
    surfaces: Map<string, unknown>;
  };
  return manager.surfaces.size;
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await testSetup!.renderOnce();
  });
}

function Harness({ preference }: { preference: ChartRendererPreference }) {
  const config = createDefaultConfig(`/tmp/gloomberb-chart-surface-${preference}`);
  config.chartPreferences.renderer = preference;

  return (
    <AppProvider config={config}>
      <ChartSurface width={20} height={4} flexDirection="column" bitmaps={[bitmap]}>
        <Text>fallback chart</Text>
      </ChartSurface>
    </AppProvider>
  );
}

afterEach(() => {
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

describe("OpenTuiChartSurface", () => {
  test("does not register kitty surfaces when the chart renderer is forced to braille", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setNativeRendererReady();
    root = createOpenTuiTestRoot(testSetup.renderer);

    act(() => {
      root!.render(<Harness preference="braille" />);
    });

    await flushFrames();

    expect(testSetup.captureCharFrame()).toContain("fallback chart");
    expect(surfaceCount()).toBe(0);
  });

  test("registers kitty surfaces when the chart renderer is forced to kitty and native graphics are ready", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 40, height: 12 });
    setNativeRendererReady();
    root = createOpenTuiTestRoot(testSetup.renderer);

    act(() => {
      root!.render(<Harness preference="kitty" />);
    });

    await flushFrames();

    expect(testSetup.captureCharFrame()).not.toContain("fallback chart");
    expect(surfaceCount()).toBe(1);
  });
});
