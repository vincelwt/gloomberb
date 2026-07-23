import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { PluginRegistry } from "../plugins/registry";
import type {
  PaneSettingActionContext,
  PaneSettingActionField,
  PaneSettingsContext,
} from "../types/plugin";
import { TestDialogProvider, testRender } from "../renderers/opentui/test-utils";
import { PaneSettingsDialogContent } from "./pane-settings-dialog";
import { TuiPaneSettingsDialogBody } from "./pane-settings-dialog/tui";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = undefined;
});

const context = {
  paneId: "test-pane:main",
  settings: {},
} as PaneSettingsContext;

function makeField(overrides: Partial<PaneSettingActionField> = {}): PaneSettingActionField {
  return {
    key: "connection",
    label: "AI Account",
    description: "Connect an account used by this pane.",
    type: "action",
    actionId: "ai.connect",
    actionLabel: "Connect",
    action: () => {},
    ...overrides,
  };
}

function makeRegistry(
  field: PaneSettingActionField,
  options: { openCommandBar?: (query?: string) => void } = {},
): PluginRegistry {
  return {
    resolvePaneSettings: () => ({
      paneId: context.paneId,
      pane: { title: "AI", paneId: "test-pane" },
      paneDef: { name: "AI" },
      settingsDef: { title: "AI Settings", fields: [field] },
      context,
    }),
    openCommandBar: options.openCommandBar ?? (() => {}),
    notify: () => {},
  } as unknown as PluginRegistry;
}

describe("pane settings action rows", () => {
  test("activates an action row from the keyboard", async () => {
    const calls: PaneSettingActionContext[] = [];
    const opened: Array<string | undefined> = [];
    let dismissed = false;
    const field = makeField({
      action: (nextContext) => {
        calls.push(nextContext);
        nextContext.openCommandBar("AI LOGIN");
      },
    });

    testSetup = await testRender(
      <TestDialogProvider>
        <PaneSettingsDialogContent
          dismiss={() => { dismissed = true; }}
          paneId={context.paneId}
          pluginRegistry={makeRegistry(field, {
            openCommandBar: (query) => { opened.push(query); },
          })}
          applyFieldValue={async () => { throw new Error("Action rows must not apply values."); }}
        />
      </TestDialogProvider>,
      { width: 72, height: 14 },
    );
    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await Promise.resolve();
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    expect(calls[0]).toMatchObject({
      paneId: context.paneId,
      settings: context.settings,
      surface: "pane-dialog",
    });
    expect(typeof calls[0]?.openCommandBar).toBe("function");
    expect(dismissed).toBe(true);
    expect(opened).toEqual(["AI LOGIN"]);
  });

  test("activates enabled TUI action rows by mouse and ignores disabled rows", async () => {
    const activated: string[] = [];
    const enabled = makeField();
    const disabled = makeField({
      key: "unavailable",
      label: "Unavailable Account",
      actionId: "ai.unavailable",
      actionLabel: "Unavailable",
      disabled: true,
    });

    testSetup = await testRender(
      <TuiPaneSettingsDialogBody
        title="AI Settings"
        fields={[enabled, disabled]}
        selectedIndex={0}
        settings={{}}
        onSelect={() => {}}
        onActivate={(field) => { if (field) activated.push(field.key); }}
      />,
      { width: 72, height: 14 },
    );
    await testSetup.renderOnce();
    const lines = testSetup.captureCharFrame().split("\n");
    const enabledRow = lines.findIndex((line) => line.includes("AI Account"));
    const disabledRow = lines.findIndex((line) => line.includes("Unavailable Account"));
    expect(enabledRow).toBeGreaterThanOrEqual(0);
    expect(disabledRow).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(4, enabledRow);
      await testSetup!.mockMouse.click(4, disabledRow);
      await testSetup!.renderOnce();
    });

    expect(activated).toEqual([enabled.key]);
  });
});
