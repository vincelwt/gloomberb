import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect, useRef, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import type { ColumnConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import type { ScrollBoxRenderable } from "../ui";
import { TickerListTable, type TickerTableCell } from "./ticker-list-table";
import { TickerListTableView } from "./ticker-list-table-view";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessTickers: ((tickers: TickerRecord[]) => void) | null = null;
let tableScrollRef: ScrollBoxRenderable | null = null;
let resolveCellCallCount = 0;

const columns: ColumnConfig[] = [
  { id: "ticker", label: "Ticker", width: 6, align: "left" },
];
const financialsMap = new Map<string, TickerFinancials>();
const manyTickers: TickerRecord[] = Array.from({ length: 1000 }, (_, index) => ({
  metadata: {
    ticker: `T${index}`,
    exchange: "NASDAQ",
    currency: "USD",
    name: `Ticker ${index}`,
    portfolios: [],
    watchlists: [],
    positions: [],
    custom: {},
    tags: [],
  },
}));

function noop(_index: number | null): void {}

function resolveCell(_column: ColumnConfig, ticker: TickerRecord, _financials: TickerFinancials | undefined): TickerTableCell {
  resolveCellCallCount += 1;
  return { text: ticker.metadata.ticker };
}

function LargeTickerListTableHarness() {
  const [cursorSymbol, setCursorSymbol] = useState("T0");
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    tableScrollRef = scrollRef.current;
    return () => {
      if (tableScrollRef === scrollRef.current) {
        tableScrollRef = null;
      }
    };
  });

  return (
    <TickerListTable
      columns={columns}
      tickers={manyTickers}
      cursorSymbol={cursorSymbol}
      hoveredIdx={null}
      setHoveredIdx={noop}
      setCursorSymbol={setCursorSymbol}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
      scrollRef={scrollRef}
    />
  );
}

function ReorderingTickerListTableViewHarness() {
  const [rows, setRows] = useState(manyTickers);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  setHarnessTickers = setRows;

  useEffect(() => {
    tableScrollRef = scrollRef.current;
    return () => {
      if (tableScrollRef === scrollRef.current) {
        tableScrollRef = null;
      }
    };
  });

  return (
    <TickerListTableView
      focused
      columns={columns}
      tickers={rows}
      cursorSymbol="T0"
      setCursorSymbol={() => {}}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
      scrollRef={scrollRef}
    />
  );
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  resolveCellCallCount = 0;
  setHarnessTickers = null;
  tableScrollRef = null;
});

describe("TickerListTable", () => {
  test("renders a bounded window for large ticker lists", async () => {
    testSetup = await testRender(
      <LargeTickerListTableHarness />,
      { width: 20, height: 6 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("T0");
    expect(frame).not.toContain("T999");
    expect(resolveCellCallCount).toBeLessThan(40);

    await act(async () => {
      for (let index = 0; index < 12; index++) {
        await testSetup!.mockMouse.scroll(2, 2, "down");
      }
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    const scrollTop = tableScrollRef?.scrollTop ?? 0;
    expect(scrollTop).toBeGreaterThan(0);
    expect(testSetup.captureCharFrame()).toContain(`T${scrollTop}`);
  });

  test("preserves manual scroll when market data reorders rows around the same cursor", async () => {
    testSetup = await testRender(
      <ReorderingTickerListTableViewHarness />,
      { width: 20, height: 8 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    tableScrollRef!.scrollTop = 20;
    expect(tableScrollRef?.scrollTop).toBe(20);

    await act(async () => {
      setHarnessTickers?.([...manyTickers.slice(1), manyTickers[0]!]);
      await Promise.resolve();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(tableScrollRef?.scrollTop).toBe(20);
  });
});
