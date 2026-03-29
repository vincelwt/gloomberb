import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DetailFeedView } from "./detail-feed-view";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

const items = [
  {
    id: "1",
    eyebrow: "Reuters",
    title: "Long headline with enough words to prove the list wraps instead of collapsing into fixed columns",
    timestamp: new Date("2024-08-01T12:00:00Z"),
    preview: "Preview text with a little more color.",
    detailTitle: "Long headline with enough words to prove the list wraps",
    detailMeta: ["Reuters", "Published Aug 1, 2024"],
    detailBody: "This body should stay readable when the pane is narrow and also when the pane is wide enough for a split layout.",
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

describe("DetailFeedView", () => {
  test("renders readable stacked content in narrow panes", async () => {
    testSetup = await testRender(
      <DetailFeedView
        width={60}
        height={16}
        items={items}
        selectedIdx={0}
        hoveredIdx={null}
        onSelect={() => {}}
        onHover={() => {}}
      />,
      { width: 60, height: 16 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Long headline with enough words");
    expect(frame).toContain("This body should stay readable");
    expect(frame).toContain("Published Aug 1, 2024");
  });

  test("renders split list and detail content in wide panes", async () => {
    testSetup = await testRender(
      <DetailFeedView
        width={110}
        height={16}
        items={items}
        selectedIdx={0}
        hoveredIdx={1}
        onSelect={() => {}}
        onHover={() => {}}
      />,
      { width: 110, height: 16 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Reuters");
    expect(frame).toContain("10-Q filing");
    expect(frame).toContain("j/k navigate");
  });

  test("renders a single-line list variant", async () => {
    testSetup = await testRender(
      <DetailFeedView
        width={110}
        height={12}
        items={items}
        selectedIdx={0}
        hoveredIdx={null}
        onSelect={() => {}}
        onHover={() => {}}
        listVariant="single-line"
        splitListWidthRatio={0.33}
      />,
      { width: 110, height: 12 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Long headline with enough words");
    expect(frame).not.toContain("Preview text with a little more color.");
  });
});
