import { describe, expect, test } from "bun:test";
import { ELECTROBUN_APPLICATION_MENU_ACTION } from "./index";
import { applicationMenuCommand } from "./click";

describe("applicationMenuCommand", () => {
  test("parses a valid open command bar event", () => {
    expect(applicationMenuCommand({
      data: {
        action: ELECTROBUN_APPLICATION_MENU_ACTION,
        data: { type: "open-command-bar", query: "DES " },
      },
    })).toEqual({ type: "open-command-bar", query: "DES " });
  });

  test("ignores events for other actions", () => {
    expect(applicationMenuCommand({
      data: {
        action: "gloom.other-action",
        data: { type: "open-command-bar", query: "DES " },
      },
    })).toBeNull();
  });

  test("parses the native devtools command", () => {
    expect(applicationMenuCommand({
      data: {
        action: ELECTROBUN_APPLICATION_MENU_ACTION,
        data: { type: "open-devtools" },
      },
    })).toEqual({ type: "open-devtools" });
  });

  test("parses the native quit command", () => {
    expect(applicationMenuCommand({
      data: {
        action: ELECTROBUN_APPLICATION_MENU_ACTION,
        data: { type: "quit" },
      },
    })).toEqual({ type: "quit" });
  });

  test("ignores unknown command types", () => {
    expect(applicationMenuCommand({
      data: {
        action: ELECTROBUN_APPLICATION_MENU_ACTION,
        data: { type: "unknown-command" },
      },
    })).toBeNull();
  });

  test("ignores plugin workflow commands without a command id", () => {
    expect(applicationMenuCommand({
      data: {
        action: ELECTROBUN_APPLICATION_MENU_ACTION,
        data: { type: "open-plugin-workflow" },
      },
    })).toBeNull();
  });
});
