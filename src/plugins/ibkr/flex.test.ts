import { describe, expect, test } from "bun:test";
import { parseFlexPositions } from "./flex";

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
