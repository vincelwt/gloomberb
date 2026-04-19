import { describe, expect, test } from "bun:test";
import { ELECTROBUN_APPLICATION_MENU_ACTION } from "./application-menu";
import { applicationMenuCommand } from "./application-menu-click";

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
