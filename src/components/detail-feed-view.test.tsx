import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  DetailFeedView,
  type DetailFeedItem,
} from "./detail-feed-view";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessItems:
  | ((items: DetailFeedItem[]) => void)
  | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setHarnessItems = undefined;
});

async function renderTwice() {
  await testSetup!.renderOnce();
  await testSetup!.renderOnce();
}

const items: DetailFeedItem[] = [
  {
    id: "1",
    eyebrow: "Reuters",
    title:
      "Long headline with enough words to prove the list wraps instead of collapsing into fixed columns",
    timestamp: new Date("2024-08-01T12:00:00Z"),
    preview: "Preview text with a little more color.",
    detailTitle: "Long headline with enough words to prove the list wraps",
    detailMeta: ["Reuters", "Published Aug 1, 2024"],
    detailBody:
      "This body should stay readable when the pane is narrow and also when the pane is wide enough for a split layout.",
    detailNote: "https://example.com/story",
  },
  {
    id: "2",
    eyebrow: "SEC",
    title: "10-Q filing",
    timestamp: new Date("2024-08-02T12:00:00Z"),
    preview: "Quarterly report",
    detailTitle: "10-Q filing",
    detailMeta: ["Filed Aug 2, 2024"],
    detailBody: "Quarterly report details.",
  },
];

function Harness({
  width,
  height,
  listVariant = "comfortable",
}: {
  width: number;
  height: number;
  listVariant?: "comfortable" | "compact" | "single-line";
}) {
  const [activeItems, setActiveItems] = useState(items);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  setHarnessItems = setActiveItems;

  return (
    <DetailFeedView
      width={width}
      height={height}
      focused
      items={activeItems}
      selectedIdx={selectedIdx}
      hoveredIdx={hoveredIdx}
      onSelect={setSelectedIdx}
      onHover={setHoveredIdx}
      listVariant={listVariant}
    />
  );
}

describe("DetailFeedView", () => {
  test("renders the browse list by default", async () => {
    testSetup = await testRender(<Harness width={60} height={16} />, {
      width: 60,
      height: 16,
    });

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Long headline with enough words");
    expect(frame).toContain("j/k move  enter open");
    expect(frame).not.toContain("This body should stay readable");
  });

  test("opens detail on enter and returns to the list with backspace", async () => {
    testSetup = await testRender(<Harness width={90} height={16} />, {
      width: 90,
      height: 16,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await renderTwice();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("<- Back");
    expect(frame).toContain("This body should stay readable");

    await act(async () => {
      testSetup!.mockInput.pressBackspace();
      await renderTwice();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Long headline with enough words");
    expect(frame).not.toContain("This body should stay readable");
  });

  test("closes the open detail page when the feed items change", async () => {
    testSetup = await testRender(<Harness width={90} height={16} />, {
      width: 90,
      height: 16,
    });

    await testSetup.renderOnce();

    await act(async () => {
      testSetup!.mockInput.pressEnter();
      await renderTwice();
    });

    await act(async () => {
      setHarnessItems?.([
        {
          id: "9",
          title: "Fresh item after source change",
          detailBody: "Replacement detail",
        },
      ]);
    });
    await renderTwice();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Fresh item after source change");
    expect(frame).not.toContain("<- Back");
    expect(frame).not.toContain("Replacement detail");
  });

  test("renders a single-line list variant", async () => {
    testSetup = await testRender(
      <Harness width={110} height={12} listVariant="single-line" />,
      { width: 110, height: 12 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Long headline with enough words");
    expect(frame).not.toContain("Preview text with a little more color.");
  });
});
