import { describe, expect, test } from "bun:test";
import type { RemoteUiNodeSnapshot } from "../../remote/types";
import {
  missingActiveTabSelections,
  type PaneScreenshotExpectedSelection,
} from "./screenshot";

describe("pane screenshot active-state verification", () => {
  const expected: PaneScreenshotExpectedSelection[] = [
    { control: "statement", label: "Cash Flow" },
    { control: "period", value: "annual" },
  ];

  test("accepts selections confirmed by the rendered semantic tab state", () => {
    expect(missingActiveTabSelections(renderedTabs("1", "annual"), expected)).toEqual([]);
  });

  test("rejects labels that are visible but not active", () => {
    expect(missingActiveTabSelections(renderedTabs("0", "quarterly"), expected))
      .toEqual(expected);
  });
});

function renderedTabs(statement: string, period: string): RemoteUiNodeSnapshot[] {
  return [
    {
      id: "statements",
      role: "tabs",
      actions: [],
      metadata: {
        activeValue: statement,
        tabs: [
          { label: "Income", value: "0" },
          { label: "Cash Flow", value: "1" },
          { label: "Balance Sheet", value: "2" },
        ],
      },
    },
    {
      id: "period",
      role: "tabs",
      actions: [],
      metadata: {
        activeValue: period,
        tabs: [
          { label: "Annual", value: "annual" },
          { label: "Quarterly", value: "quarterly" },
        ],
      },
    },
  ];
}
