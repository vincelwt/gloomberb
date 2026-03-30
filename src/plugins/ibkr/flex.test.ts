import { describe, expect, test } from "bun:test";
import { parseFlexAccounts, parseFlexPositions } from "./flex";

describe("parseFlexPositions", () => {
  test("parses option positions with broker contract metadata", () => {
    const xml = `
      <FlexQueryResponse>
        <OpenPositions>
          <OpenPosition accountId="DU12345" symbol="SPY  260619C00500000" description="SPY Jun19'26 500 Call" assetCategory="OPT" position="2" costBasisPrice="4.25" currency="USD" exchange="SMART" conid="123456" listingExchange="SMART" multiplier="100" expiry="20260619" strike="500" putCall="CALL" localSymbol="SPY  260619C00500000" tradingClass="SPY" />
        </OpenPositions>
      </FlexQueryResponse>
    `;

    const positions = parseFlexPositions(xml);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.ticker).toBe("SPY  260619C00500000");
    expect(positions[0]?.brokerContract).toEqual({
      brokerId: "ibkr",
      conId: 123456,
      symbol: "SPY  260619C00500000",
      localSymbol: "SPY  260619C00500000",
      secType: "OPT",
      exchange: "SMART",
      primaryExchange: "SMART",
      currency: "USD",
      lastTradeDateOrContractMonth: "20260619",
      right: "C",
      strike: 500,
      multiplier: "100",
      tradingClass: "SPY",
    });
  });
});

describe("parseFlexAccounts", () => {
  test("parses cash balances and summary values from a flex statement", () => {
    const xml = `
      <FlexQueryResponse>
        <FlexStatements count="1">
          <FlexStatement accountId="DU12345" fromDate="20260327" toDate="20260327" whenGenerated="20260328;102707">
            <ChangeInNAV accountId="DU12345" acctAlias="Main" currency="USD" endingValue="764713.626876249" />
            <CashReport>
              <CashReportCurrency accountId="DU12345" currency="BASE_SUMMARY" endingCash="-1050953.720462251" endingSettledCash="-917604.448220862" />
            </CashReport>
            <FxPositions>
              <FxPosition accountId="DU12345" assetCategory="CASH" functionalCurrency="USD" fxCurrency="USD" quantity="-303029.144938754" value="-303029.144938754" />
              <FxPosition accountId="DU12345" assetCategory="CASH" functionalCurrency="USD" fxCurrency="EUR" quantity="-351957.025" value="-405102.535775" />
            </FxPositions>
          </FlexStatement>
        </FlexStatements>
      </FlexQueryResponse>
    `;

    const accounts = parseFlexAccounts(xml);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accountId: "DU12345",
      name: "Main",
      currency: "USD",
      source: "flex",
      netLiquidation: 764713.626876249,
      totalCashValue: -1050953.720462251,
      settledCash: -917604.448220862,
      cashBalances: [
        {
          currency: "USD",
          quantity: -303029.144938754,
          baseValue: -303029.144938754,
          baseCurrency: "USD",
        },
        {
          currency: "EUR",
          quantity: -351957.025,
          baseValue: -405102.535775,
          baseCurrency: "USD",
        },
      ],
    });
    expect(accounts[0]?.updatedAt).toBe(new Date(2026, 2, 28, 10, 27, 7).getTime());
  });

  test("handles missing cash sections gracefully", () => {
    const xml = `
      <FlexQueryResponse>
        <FlexStatements count="1">
          <FlexStatement accountId="DU12345" fromDate="20260327" toDate="20260327">
            <ChangeInNAV accountId="DU12345" currency="USD" endingValue="12345.67" />
          </FlexStatement>
        </FlexStatements>
      </FlexQueryResponse>
    `;

    expect(parseFlexAccounts(xml)).toEqual([
      {
        accountId: "DU12345",
        name: "DU12345",
        currency: "USD",
        source: "flex",
        updatedAt: new Date(2026, 2, 27).getTime(),
        netLiquidation: 12345.67,
        totalCashValue: undefined,
        settledCash: undefined,
        cashBalances: undefined,
      },
    ]);
  });
});
