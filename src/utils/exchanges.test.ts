import { describe, expect, test } from "bun:test";
import {
  canonicalExchange,
  canonicalTickerKey,
  publicExchange,
  publicTickerKey,
} from "./exchanges";

describe("exchange normalization", () => {
  test("canonicalizes exchange aliases for internal keys", () => {
    expect(canonicalExchange("XNAS")).toBe("NASDAQ");
    expect(canonicalExchange("XNYS")).toBe("NYSE");
    expect(canonicalExchange("XETR")).toBe("XETRA");
    expect(canonicalTickerKey("aapl", "XNAS")).toBe("AAPL:NASDAQ");
  });

  test("uses public exchange ids for cloud news filters", () => {
    expect(publicExchange("NASDAQ")).toBe("XNAS");
    expect(publicExchange("XNAS")).toBe("XNAS");
    expect(publicExchange("XETRA")).toBe("XETR");
    expect(publicTickerKey("aapl", "NASDAQ")).toBe("AAPL:XNAS");
    expect(publicTickerKey("BMW", "XETRA")).toBe("BMW:XETR");
  });
});
