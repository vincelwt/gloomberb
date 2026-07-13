import { describe, expect, test } from "bun:test";
import { createCapabilityInvoker } from "./capability-invoker";

describe("createCapabilityInvoker", () => {
  test("keeps timed-out calls deduped until the raw backend request settles", async () => {
    let requestCount = 0;
    const rawResolvers: Array<(value: unknown) => void> = [];
    const invoke = createCapabilityInvoker({
      request: <T>() => {
        requestCount += 1;
        return new Promise<T>((resolve) => {
          rawResolvers.push((value) => resolve(value as T));
        });
      },
      shouldApplyDeadline: (capabilityId) => capabilityId.startsWith("asset-data."),
      timeoutMs: 10,
    });
    const payload = { ticker: "AAPL", exchange: "NASDAQ" };

    const first = invoke("asset-data.asset-data-router", "getQuote", payload);
    const duplicate = invoke("asset-data.asset-data-router", "getQuote", payload);
    expect(duplicate).toBe(first);
    expect(requestCount).toBe(1);
    await expect(first).rejects.toThrow("Asset data request timed out after 10ms");

    const retryWhileRawPending = invoke(
      "asset-data.asset-data-router",
      "getQuote",
      payload,
    );
    expect(retryWhileRawPending).toBe(first);
    await expect(retryWhileRawPending).rejects.toThrow(
      "Asset data request timed out after 10ms",
    );
    expect(requestCount).toBe(1);

    rawResolvers[0]?.({ price: 100 });
    await Promise.resolve();
    await Promise.resolve();

    const retryAfterRawSettles = invoke(
      "asset-data.asset-data-router",
      "getQuote",
      payload,
    );
    expect(requestCount).toBe(2);
    rawResolvers[1]?.({ price: 101 });
    await expect(retryAfterRawSettles).resolves.toEqual({ price: 101 });
  });
});
