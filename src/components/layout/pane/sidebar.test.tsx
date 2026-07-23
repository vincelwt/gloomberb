import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../renderers/opentui/test-utils";
import { Text } from "../../../ui";
import {
  getPaneSidebarWidth,
  PaneSidebar,
  PaneSidebarAction,
  PaneSidebarRow,
  shouldShowPaneSidebar,
} from "./sidebar";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
    testSetup = undefined;
  });
});

describe("pane sidebar metrics", () => {
  test("uses the shared responsive breakpoint and host-specific widths", () => {
    expect(shouldShowPaneSidebar(2, 72, 8)).toBe(true);
    expect(shouldShowPaneSidebar(1, 72, 8)).toBe(false);
    expect(shouldShowPaneSidebar(1, 72, 8, 1)).toBe(true);
    expect(shouldShowPaneSidebar(2, 71, 8)).toBe(false);
    expect(shouldShowPaneSidebar(2, 72, 7)).toBe(false);

    expect(getPaneSidebarWidth(72, false)).toBe(18);
    expect(getPaneSidebarWidth(100, false)).toBe(24);
    expect(getPaneSidebarWidth(72, true)).toBe(14);
    expect(getPaneSidebarWidth(90, true)).toBe(17);
    expect(getPaneSidebarWidth(200, true)).toBe(19);
  });
});

test("renders a terminal divider and keeps nested actions from selecting their row", async () => {
  let selections = 0;
  let actions = 0;

  await act(async () => {
    testSetup = await testRender(
      <PaneSidebar width={20} height={4} focused keyboardFocused>
        <PaneSidebarRow
          active={false}
          ariaLabel="Alpha conversation"
          onSelect={() => {
            selections += 1;
          }}
        >
          {({ foregroundColor, onMouseDown }) => (
            <>
              <Text fg={foregroundColor} onMouseDown={onMouseDown}> Alpha</Text>
              <PaneSidebarAction
                width={3}
                ariaLabel="New conversation"
                onPress={() => {
                  actions += 1;
                }}
              >
                {({ foregroundColor: actionColor, onMouseDown: onActionMouseDown }) => (
                  <Text fg={actionColor} onMouseDown={onActionMouseDown}>+</Text>
                )}
              </PaneSidebarAction>
            </>
          )}
        </PaneSidebarRow>
      </PaneSidebar>,
      { width: 24, height: 4 },
    );
  });
  await act(async () => {
    await testSetup!.renderOnce();
  });

  const frame = testSetup!.captureCharFrame();
  const lines = frame.split("\n");
  const row = lines.findIndex((line) => line.includes("Alpha"));
  const labelColumn = lines[row]?.indexOf("Alpha") ?? -1;
  const actionColumn = lines[row]?.indexOf("+") ?? -1;
  expect(row).toBeGreaterThanOrEqual(0);
  expect(labelColumn).toBeGreaterThanOrEqual(0);
  expect(actionColumn).toBeGreaterThanOrEqual(0);
  expect(lines.slice(0, 4).every((line) => line[19] === "│")).toBe(true);

  await act(async () => {
    await testSetup!.mockMouse.click(labelColumn, row);
    await testSetup!.renderOnce();
  });
  expect(selections).toBe(1);
  expect(actions).toBe(0);

  await act(async () => {
    await testSetup!.mockMouse.click(actionColumn, row);
    await testSetup!.renderOnce();
  });
  expect(actions).toBe(1);
  expect(selections).toBe(1);
});
