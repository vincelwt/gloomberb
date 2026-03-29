import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
import { StatusBar } from "./status-bar";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("StatusBar", () => {
  test("renders layout tabs without preview suffixes", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const researchLayout = cloneLayout(config.layout);
    researchLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    researchLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }];

    const state = {
      ...createInitialState({
        ...config,
        layouts: [
          { name: "Default", layout: cloneLayout(config.layout) },
          { name: "Research", layout: researchLayout },
        ],
      }),
      statusBarVisible: true,
    };

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Default");
    expect(frame).toContain("Research");
  });
});
