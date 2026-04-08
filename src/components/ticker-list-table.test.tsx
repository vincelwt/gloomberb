import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { ColumnConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { TickerListTable, type TickerTableCell } from "./ticker-list-table";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessCursorSymbol: ((symbol: string) => void) | null = null;
let resolveCellCallCount = 0;

const columns: ColumnConfig[] = [
  { id: "ticker", label: "Ticker", width: 6, align: "left" },
];
const financialsMap = new Map<string, TickerFinancials>();
const tickers: TickerRecord[] = [
  { metadata: { ticker: "AAPL", exchange: "NASDAQ", currency: "USD", name: "Apple", portfolios: [], watchlists: [], positions: [], custom: {}, tags: [] } },
  { metadata: { ticker: "MSFT", exchange: "NASDAQ", currency: "USD", name: "Microsoft", portfolios: [], watchlists: [], positions: [], custom: {}, tags: [] } },
  { metadata: { ticker: "NVDA", exchange: "NASDAQ", currency: "USD", name: "NVIDIA", portfolios: [], watchlists: [], positions: [], custom: {}, tags: [] } },
];

function noop(_index: number | null): void {}

function resolveCell(_column: ColumnConfig, ticker: TickerRecord, _financials: TickerFinancials | undefined): TickerTableCell {
  resolveCellCallCount += 1;
  return { text: ticker.metadata.ticker };
}

function TickerListTableHarness() {
  const [cursorSymbol, setCursorSymbol] = useState("AAPL");
  setHarnessCursorSymbol = (symbol: string) => setCursorSymbol(symbol);

  return (
    <TickerListTable
      columns={columns}
      tickers={tickers}
      cursorSymbol={cursorSymbol}
      hoveredIdx={null}
      setHoveredIdx={noop}
      setCursorSymbol={setCursorSymbol}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
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
  setHarnessCursorSymbol = null;
});

describe("TickerListTable", () => {
  test("recomputes cells only for rows whose selection state changed", async () => {
    testSetup = await testRender(
      <TickerListTableHarness />,
      { width: 20, height: 6 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const initialCallCount = resolveCellCallCount;

    await act(async () => {
      setHarnessCursorSymbol?.("MSFT");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(initialCallCount).toBeGreaterThan(0);
    expect(resolveCellCallCount - initialCallCount).toBe(2);
  });
});
