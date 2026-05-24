import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { PaneHeader } from "./header";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("PaneHeader", () => {
  test("fires the terminal action handler from the visible action text", async () => {
    let actions = 0;
    testSetup = await testRender(
      <PaneHeader
        title="Portfolio"
        width={40}
        focused
        showActions
        onActionMouseDown={() => { actions += 1; }}
      />,
      { width: 40, height: 3 },
    );

    await testSetup.renderOnce();
    const actionCol = testSetup.captureCharFrame().split("\n")[0]?.indexOf("...");
    expect(actionCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(actionCol! + 1, 0);
    });

    expect(actions).toBe(1);
  });
});
