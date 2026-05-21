import { describe, expect, test } from "bun:test";
import { resolvePortfolioAccountState } from "./summary";

describe("resolvePortfolioAccountState", () => {
  test("does not reuse a single cached broker account for a different explicit portfolio account", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-flex:U12345",
      name: "U12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
      brokerAccountId: "U12345",
    }, {
      config: {
        brokerInstances: [{
          id: "ibkr-flex",
          label: "IBKR Flex",
          brokerType: "ibkr",
          enabled: true,
          config: {},
        }],
      } as any,
      brokerAccounts: {
        "ibkr-flex": [{
          accountId: "alias-account",
          name: "alias-account",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-05-15T05:02:17.000Z").getTime(),
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState).toBeNull();
  });

  test("still uses the only cached broker account for legacy broker portfolios without an account id", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-flex:default",
      name: "IBKR Flex",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    }, {
      config: {
        brokerInstances: [{
          id: "ibkr-flex",
          label: "IBKR Flex",
          brokerType: "ibkr",
          enabled: true,
          config: {},
        }],
      } as any,
      brokerAccounts: {
        "ibkr-gateway": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "gateway",
          updatedAt: new Date("2026-05-14T05:02:17.000Z").getTime(),
          netLiquidation: 100000,
        }],
        "ibkr-flex": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.accountId).toBe("U12345");
  });

  test("uses exact cached account data from another profile for the same broker account", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-gateway:U12345",
      name: "U12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-gateway",
      brokerAccountId: "U12345",
    }, {
      config: {
        brokerInstances: [
          {
            id: "ibkr-gateway",
            label: "IBKR Gateway",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
          {
            id: "ibkr-flex",
            label: "IBKR Flex",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
        ],
      } as any,
      brokerAccounts: {
        "ibkr-flex": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-05-15T05:02:17.000Z").getTime(),
          netLiquidation: 123456,
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.netLiquidation).toBe(123456);
    expect(accountState?.sourceLabel).toBe("Flex May 15");
  });
});
