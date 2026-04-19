import { describe, expect, test } from "bun:test";
import { ELECTROBUN_CONTEXT_MENU_ACTION } from "../shared/protocol";
import { contextMenuSelectionMessage } from "./context-menu-click";

describe("contextMenuSelectionMessage", () => {
  test("extracts custom menu selections encoded in the native action string", () => {
    expect(contextMenuSelectionMessage({
      name: "context-menu-clicked",
      data: {
        action: `${ELECTROBUN_CONTEXT_MENU_ACTION}:ctx%3A1:pane%3Asettings`,
      },
    }, ELECTROBUN_CONTEXT_MENU_ACTION)).toEqual({
      requestId: "ctx:1",
      itemId: "pane:settings",
    });
  });

  test("extracts custom menu selections from Electrobun event wrappers", () => {
    expect(contextMenuSelectionMessage({
      name: "context-menu-clicked",
      data: {
        action: ELECTROBUN_CONTEXT_MENU_ACTION,
        data: {
          requestId: "ctx:1",
          itemId: "pane:settings",
        },
      },
    }, ELECTROBUN_CONTEXT_MENU_ACTION)).toEqual({
      requestId: "ctx:1",
      itemId: "pane:settings",
    });
  });

  test("also accepts a bare native menu payload", () => {
    expect(contextMenuSelectionMessage({
      action: ELECTROBUN_CONTEXT_MENU_ACTION,
      data: {
        requestId: "ctx:2",
        itemId: "pane:close",
      },
    }, ELECTROBUN_CONTEXT_MENU_ACTION)).toEqual({
      requestId: "ctx:2",
      itemId: "pane:close",
    });
  });

  test("ignores nonmatching and malformed native menu selections", () => {
    expect(contextMenuSelectionMessage({
      data: {
        action: "other",
        data: {
          requestId: "ctx:3",
          itemId: "pane:close",
        },
      },
    }, ELECTROBUN_CONTEXT_MENU_ACTION)).toBeNull();

    expect(contextMenuSelectionMessage({
      data: {
        action: ELECTROBUN_CONTEXT_MENU_ACTION,
        data: {
          requestId: "ctx:3",
        },
      },
    }, ELECTROBUN_CONTEXT_MENU_ACTION)).toBeNull();
  });
});
