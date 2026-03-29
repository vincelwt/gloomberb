import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { createDefaultConfig } from "../../types/config";
import { AppContext, createInitialState, PaneInstanceProvider } from "../../state/app-context";
import { FinancialsTab } from "./ticker-detail";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function createTickerDetailHarness() {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  (config.layout as typeof config.layout & { docked: Array<{ instanceId: string; columnIndex: number; order: number }> }).docked = [
    { instanceId: "portfolio-list:main", columnIndex: 0, order: 0 },
    { instanceId: "ticker-detail:main", columnIndex: 1, order: 0 },
  ];
  config.layout.instances = config.layout.instances.map((instance) => (
    instance.instanceId === "ticker-detail:main"
      ? { ...instance, binding: { kind: "fixed" as const, symbol: "2337" } }
      : instance
  ));

  const state = createInitialState(config);

  const ticker: TickerRecord = {
    metadata: {
      ticker: "2337",
      exchange: "TSE",
      currency: "USD",
      name: "Mock Co",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };

  const financials: TickerFinancials = {
    annualStatements: [
      { date: "2021-12-31" },
      { date: "2022-12-31", totalRevenue: 43.49e9, operatingIncome: 9.37e9, eps: 4.68 },
      { date: "2023-12-31", totalRevenue: 27.62e9, operatingIncome: -2.40e9, eps: -0.92 },
      { date: "2024-12-31", totalRevenue: 25.88e9, operatingIncome: -3.92e9, eps: -1.73 },
      { date: "2025-12-31", totalRevenue: 28.88e9, operatingIncome: -3.70e9, eps: -1.77 },
    ],
    quarterlyStatements: [
      { date: "2025-03-31", totalRevenue: 6e9, operatingIncome: -1e9, eps: -0.40 },
      { date: "2025-06-30", totalRevenue: 6.5e9, operatingIncome: -1.1e9, eps: -0.42 },
      { date: "2025-09-30", totalRevenue: 7e9, operatingIncome: -1.2e9, eps: -0.45 },
      { date: "2025-12-31", totalRevenue: 7.08e9, operatingIncome: -1.01e9, eps: -0.50 },
    ],
    priceHistory: [],
  };

  state.tickers = new Map([["2337", ticker]]);
  state.financials = new Map([["2337", financials]]);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="ticker-detail:main">
        <FinancialsTab focused />
      </PaneInstanceProvider>
    </AppContext>
  );
}

describe("FinancialsTab", () => {
  test("keeps negative-value rows aligned with the annual columns", async () => {
    testSetup = await testRender(createTickerDetailHarness(), {
      width: 140,
      height: 20,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    const revenueLine = frame.split("\n").find((line) => line.includes("Revenue (B)"));
    const operatingIncomeLine = frame.split("\n").find((line) => line.includes("Operating Inc (B)"));

    expect(revenueLine).toBeDefined();
    expect(operatingIncomeLine).toBeDefined();

    expect(operatingIncomeLine!.indexOf("-4.31")).toBe(revenueLine!.indexOf("26.58"));
    expect(operatingIncomeLine!.indexOf("-3.70")).toBe(revenueLine!.indexOf("28.88"));
    expect(operatingIncomeLine!.indexOf("-3.92")).toBe(revenueLine!.indexOf("25.88"));
    expect(operatingIncomeLine!.indexOf("-2.40")).toBe(revenueLine!.indexOf("27.62"));
    expect(operatingIncomeLine!.indexOf("—")).toBe(revenueLine!.lastIndexOf("—"));
  });
});
