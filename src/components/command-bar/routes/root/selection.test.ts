import { describe, expect, test } from "bun:test";
import type { Command } from "../../commands/registry";
import { buildImmediateRootSelection } from "./selection";

const languageCommand: Command = {
  id: "language",
  prefix: "LANG",
  label: "Change Language",
  description: "Switch the interface language",
  hasArg: true,
  argPlaceholder: "locale",
  category: "Config",
};

describe("root command selection", () => {
  function selectLanguage(query: string, onRun: (arg: string) => void) {
    return buildImmediateRootSelection({
      query,
      activeTickerSymbol: null,
      availableCommands: [languageCommand],
      createPaneTemplateItem: () => { throw new Error("Unexpected pane template"); },
      createPluginCommandItem: () => { throw new Error("Unexpected plugin command"); },
      executeCollectionCommand: () => {},
      getAvailablePaneShortcutTemplates: () => [],
      getAvailablePluginCommands: () => [],
      openModeRoute: () => {},
      openPaneTemplateWorkflow: () => {},
      pluginCommandResultItems: () => [],
      runDirectCommand: (_command, arg) => onRun(arg),
      runSecurityDescriptionShortcut: () => {},
      setRootQuery: () => {},
      startThemePicker: () => {},
    });
  }

  test("passes an explicit locale argument to the language action", () => {
    const receivedArgs: string[] = [];
    const selection = selectLanguage("LANG ja", (arg) => { receivedArgs.push(arg); });

    expect(selection?.label).toBe("Change Language");
    expect(selection?.right).toBe("ja");
    selection?.action();
    expect(receivedArgs).toEqual(["ja"]);
  });

  test("keeps bare LANG available for cycling", () => {
    const receivedArgs: string[] = [];
    const selection = selectLanguage("LANG", (arg) => { receivedArgs.push(arg); });

    expect(selection?.label).toBe("Change Language");
    selection?.action();
    expect(receivedArgs).toEqual([""]);
  });
});
