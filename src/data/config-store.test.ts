import { describe, expect, test } from "bun:test";
import { sanitizeLayout } from "./config-store";
import { DEFAULT_LAYOUT, findPaneInstance, type LayoutConfig } from "../types/config";

describe("sanitizeLayout", () => {
  test("rewrites unbound ticker-detail panes to follow the first portfolio pane", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "50%" }, { width: "50%" }],
      instances: [
        {
          instanceId: "portfolio-list:main",
          paneId: "portfolio-list",
          binding: { kind: "none" },
          params: { collectionId: "main" },
        },
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "none" },
        },
      ],
      docked: [
        { instanceId: "portfolio-list:main", columnIndex: 0 },
        { instanceId: "ticker-detail:main", columnIndex: 1 },
      ],
      floating: [],
    } satisfies LayoutConfig, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")?.binding).toEqual({
      kind: "follow",
      sourceInstanceId: "portfolio-list:main",
    });
  });

  test("removes follow panes whose source pane is missing", () => {
    const layout = sanitizeLayout({
      columns: [{ width: "100%" }],
      instances: [
        {
          instanceId: "ticker-detail:main",
          paneId: "ticker-detail",
          binding: { kind: "follow", sourceInstanceId: "portfolio-list:missing" },
        },
      ],
      docked: [{ instanceId: "ticker-detail:main", columnIndex: 0 }],
      floating: [],
    } satisfies LayoutConfig, DEFAULT_LAYOUT);

    expect(findPaneInstance(layout, "ticker-detail:main")).toBeUndefined();
    expect(layout.docked).toHaveLength(0);
  });
});
