import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../state/app-context";
import { createDefaultConfig } from "../types/config";
import {
  FeedDataTableStackView,
  type FeedDataTableItem,
} from "./feed-data-table-stack-view";
import { Box, Text } from "../ui";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessItems:
  | ((items: FeedDataTableItem[]) => void)
  | undefined;
let harnessSelectedIdx = 0;
let rootKeyHits = 0;

const items: FeedDataTableItem[] = [
  {
    id: "1",
    eyebrow: "Reuters",
    title:
      "Long headline with enough words to prove the table truncates cleanly",
    timestamp: new Date("2024-08-01T12:00:00Z"),
    preview: "Preview text with a little more color.",
    detailTitle: "Long headline with enough words",
    detailMeta: ["Reuters", "Published Aug 1, 2024"],
    detailBody:
      "This body should stay readable when the pane opens the detail page.",
    detailNote: "https://example.com/story",
  },
  {
    id: "2",
    eyebrow: "10-Q",
    title: "10-Q filing",
    timestamp: new Date("2024-08-02T12:00:00Z"),
    preview: "Quarterly report",
    detailTitle: "10-Q filing",
    detailMeta: ["Filed Aug 2, 2024"],
    detailBody: "Quarterly report details.",
  },
];

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  setHarnessItems = undefined;
  harnessSelectedIdx = 0;
  rootKeyHits = 0;
});

function Harness({
  width,
  height,
  withRootControls = false,
}: {
  width: number;
  height: number;
  withRootControls?: boolean;
}) {
  const [activeItems, setActiveItems] = useState(items);
  const [selectedIdx, setSelectedIdx] = useState(0);

  setHarnessItems = setActiveItems;
  harnessSelectedIdx = selectedIdx;

  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-detail-data-table-test"),
  );

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="portfolio-list:main">
        <FeedDataTableStackView
          width={width}
          height={height}
          focused
          items={activeItems}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          rootBefore={withRootControls ? (
            <Box height={1}>
              <Text>Feed controls</Text>
            </Box>
          ) : undefined}
          onRootKeyDown={withRootControls ? (event) => {
            if (event.name !== "f") return false;
            rootKeyHits += 1;
            return true;
          } : undefined}
          sourceLabel="Source"
          titleLabel="Headline"
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function clickAt(x: number, y: number) {
  await act(async () => {
    await testSetup!.mockMouse.click(x, y);
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(event: { name?: string; sequence?: string }) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    } as any);
    await testSetup!.renderOnce();
  });
}

describe("FeedDataTableStackView", () => {
  test("renders a DataTable list by default", async () => {
    testSetup = await testRender(<Harness width={90} height={16} />, {
      width: 90,
      height: 16,
    });

    await renderSettled();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Time");
    expect(frame).toContain("Source");
    expect(frame).toContain("Headline");
    expect(frame).toContain("10-Q filing");
    expect(frame).not.toContain("j/k move");
    expect(frame).not.toContain("Quarterly report details.");
  });

  test("selects a row on first click without opening detail", async () => {
    testSetup = await testRender(<Harness width={90} height={16} />, {
      width: 90,
      height: 16,
    });

    await renderSettled();

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const filingRow = lines.findIndex((line) => line.includes("10-Q filing"));

    await clickAt(2, filingRow);

    const nextFrame = testSetup.captureCharFrame();
    expect(harnessSelectedIdx).toBe(1);
    expect(nextFrame).not.toContain("<- Back");
    expect(nextFrame).not.toContain("Quarterly report details.");
  });

  test("opens detail from the selected row and closes it when items change", async () => {
    testSetup = await testRender(<Harness width={90} height={16} />, {
      width: 90,
      height: 16,
    });

    await renderSettled();

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const filingRow = lines.findIndex((line) => line.includes("10-Q filing"));

    await clickAt(2, filingRow);
    expect(harnessSelectedIdx).toBe(1);
    await clickAt(2, filingRow);
    await renderSettled();

    expect(testSetup.captureCharFrame()).toContain("Quarterly report details.");

    await act(async () => {
      setHarnessItems?.([
        {
          id: "9",
          title: "Fresh item after source change",
          detailBody: "Replacement detail",
        },
      ]);
    });
    await renderSettled();

    const nextFrame = testSetup.captureCharFrame();
    expect(nextFrame).toContain("Fresh item after source change");
    expect(nextFrame).not.toContain("<- Back");
    expect(nextFrame).not.toContain("Replacement detail");
  });

  test("renders root controls and delegates root key handling", async () => {
    testSetup = await testRender(<Harness width={90} height={16} withRootControls />, {
      width: 90,
      height: 16,
    });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("Feed controls");

    await emitKeypress({ name: "f", sequence: "f" });
    expect(rootKeyHits).toBe(1);
  });
});
