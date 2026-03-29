import { describe, expect, test } from "bun:test";
import { summarizeBrokerAccount } from "./gateway-service";

function makeTags(input: Record<string, Record<string, string>>) {
  return new Map(
    Object.entries(input).map(([tag, values]) => [
      tag,
      new Map(Object.entries(values).map(([currency, value]) => [currency, { value }])),
    ]),
  );
}

describe("summarizeBrokerAccount", () => {
  test("maps gateway account summary fields and ledger balances", () => {
    const tags = makeTags({
      NetLiquidation: { USD: "764713.62" },
      TotalCashValue: { USD: "-1050953.72" },
      SettledCash: { USD: "-917604.44" },
      AvailableFunds: { USD: "112345.67" },
      BuyingPower: { USD: "224691.34" },
      ExcessLiquidity: { USD: "98321.12" },
      InitMarginReq: { USD: "45678.9" },
      MaintMarginReq: { USD: "34567.8" },
      "$LEDGER:ALL": { USD: "-303029.14", EUR: "-351957.02" },
    });

    expect(summarizeBrokerAccount("DU12345", tags, 1_717_000_000_000)).toEqual({
      accountId: "DU12345",
      name: "DU12345",
      currency: "USD",
      source: "gateway",
      updatedAt: 1_717_000_000_000,
      netLiquidation: 764713.62,
      totalCashValue: -1050953.72,
      settledCash: -917604.44,
      availableFunds: 112345.67,
      buyingPower: 224691.34,
      excessLiquidity: 98321.12,
      initMarginReq: 45678.9,
      maintMarginReq: 34567.8,
      cashBalances: [
        { currency: "USD", quantity: -303029.14, baseValue: -303029.14, baseCurrency: "USD" },
        { currency: "EUR", quantity: -351957.02, baseValue: undefined, baseCurrency: "USD" },
      ],
    });
  });

  test("falls back to the aggregate cash summary for single-account gateways", () => {
    const accountTags = makeTags({
      NetLiquidation: { USD: "129360.15" },
      TotalCashValue: { USD: "128293.79" },
      AvailableFunds: { USD: "129031.52" },
      BuyingPower: { USD: "860210.13" },
      ExcessLiquidity: { USD: "129061.51" },
      InitMarginReq: { USD: "328.63" },
      MaintMarginReq: { USD: "298.64" },
    });
    const aggregateTags = makeTags({
      CashBalance: {
        HKD: "1012836.31",
        USD: "-1020.86",
        BASE: "128293.7944",
      },
      ExchangeRate: {
        HKD: "0.1276758",
        USD: "1.00",
        BASE: "1.00",
      },
    });

    expect(summarizeBrokerAccount("DU12345", accountTags, 1_717_000_000_000, aggregateTags, true)).toEqual({
      accountId: "DU12345",
      name: "DU12345",
      currency: "USD",
      source: "gateway",
      updatedAt: 1_717_000_000_000,
      netLiquidation: 129360.15,
      totalCashValue: 128293.79,
      settledCash: undefined,
      availableFunds: 129031.52,
      buyingPower: 860210.13,
      excessLiquidity: 129061.51,
      initMarginReq: 328.63,
      maintMarginReq: 298.64,
      cashBalances: [
        { currency: "HKD", quantity: 1012836.31, baseValue: 129314.68614829802, baseCurrency: "USD" },
        { currency: "USD", quantity: -1020.86, baseValue: -1020.86, baseCurrency: "USD" },
      ],
    });
  });

  test("returns a minimal account when summary tags are missing", () => {
    expect(summarizeBrokerAccount("DU12345", undefined, 123)).toEqual({
      accountId: "DU12345",
      name: "DU12345",
      currency: undefined,
      source: "gateway",
      updatedAt: 123,
      netLiquidation: undefined,
      totalCashValue: undefined,
      settledCash: undefined,
      availableFunds: undefined,
      buyingPower: undefined,
      excessLiquidity: undefined,
      initMarginReq: undefined,
      maintMarginReq: undefined,
      cashBalances: undefined,
    });
  });
});
