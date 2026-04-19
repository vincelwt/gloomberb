import { describe, expect, test } from "bun:test";
import { ELECTROBUN_CONTEXT_MENU_ACTION } from "../shared/protocol";
import { getContextMenuRequestId, normalizeContextMenuItems } from "./context-menu-normalize";

describe("normalizeContextMenuItems", () => {
  test("keeps encoded custom actions and discovers their request id", () => {
    const menu = normalizeContextMenuItems([
      {
        label: "Settings",
        action: `${ELECTROBUN_CONTEXT_MENU_ACTION}:ctx%3A1:settings`,
      },
    ]);

    expect(menu).toEqual([
      {
        type: "normal",
        label: "Settings",
        tooltip: undefined,
        enabled: true,
        checked: false,
        hidden: false,
        accelerator: undefined,
        action: `${ELECTROBUN_CONTEXT_MENU_ACTION}:ctx%3A1:settings`,
      },
    ]);
    expect(getContextMenuRequestId(menu)).toBe("ctx:1");
  });

  test("keeps legacy custom actions that carry request data separately", () => {
    const menu = normalizeContextMenuItems([
      {
        label: "Pop Out",
        action: ELECTROBUN_CONTEXT_MENU_ACTION,
        data: {
          requestId: "ctx:2",
          itemId: "pop-out",
        },
      },
    ]);

    expect(menu).toMatchObject([
      {
        action: ELECTROBUN_CONTEXT_MENU_ACTION,
        data: {
          requestId: "ctx:2",
          itemId: "pop-out",
        },
      },
    ]);
    expect(getContextMenuRequestId(menu)).toBe("ctx:2");
  });
});
