import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { useThrottledCursorSymbol } from "./use-throttled-cursor-symbol";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setHarnessCursorSymbol: ((symbol: string | null, options?: { immediate?: boolean }) => void) | null = null;
let flushHarnessCursorSymbol: ((symbol?: string | null) => void) | null = null;
let latestCursorSymbol: string | null = null;
let latestCommittedCursorSymbol: string | null = null;

const TEST_THROTTLE_MS = 80;

function ThrottledCursorHarness() {
  const [committedCursorSymbol, setCommittedCursorSymbol] = useState<string | null>("AAPL");
  const {
    cursorSymbol,
    setCursorSymbol,
    flushCursorSymbol,
  } = useThrottledCursorSymbol(committedCursorSymbol, setCommittedCursorSymbol, TEST_THROTTLE_MS);

  latestCursorSymbol = cursorSymbol;
  latestCommittedCursorSymbol = committedCursorSymbol;
  setHarnessCursorSymbol = setCursorSymbol;
  flushHarnessCursorSymbol = flushCursorSymbol;

  return <text>{cursorSymbol ?? "none"}|{committedCursorSymbol ?? "none"}</text>;
}

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  setHarnessCursorSymbol = null;
  flushHarnessCursorSymbol = null;
  latestCursorSymbol = null;
  latestCommittedCursorSymbol = null;
});

describe("useThrottledCursorSymbol", () => {
  test("keeps the highlighted row immediate while settling the committed cursor", async () => {
    testSetup = await testRender(<ThrottledCursorHarness />, {
      width: 24,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    await act(async () => {
      setHarnessCursorSymbol?.("MSFT");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCursorSymbol).toBe("MSFT");
    expect(latestCommittedCursorSymbol).toBe("AAPL");

    await act(async () => {
      setHarnessCursorSymbol?.("NVDA");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCursorSymbol).toBe("NVDA");
    expect(latestCommittedCursorSymbol).toBe("AAPL");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TEST_THROTTLE_MS + 20));
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCommittedCursorSymbol).toBe("NVDA");
  });

  test("coalesces repeated cursor moves into the final committed symbol", async () => {
    testSetup = await testRender(<ThrottledCursorHarness />, {
      width: 24,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    await act(async () => {
      setHarnessCursorSymbol?.("MSFT");
      await Promise.resolve();
    });
    await act(async () => {
      setHarnessCursorSymbol?.("NVDA");
      await Promise.resolve();
    });
    await act(async () => {
      setHarnessCursorSymbol?.("AMD");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCursorSymbol).toBe("AMD");
    expect(latestCommittedCursorSymbol).toBe("AAPL");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TEST_THROTTLE_MS + 20));
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCommittedCursorSymbol).toBe("AMD");
  });

  test("can flush a pending cursor immediately", async () => {
    testSetup = await testRender(<ThrottledCursorHarness />, {
      width: 24,
      height: 1,
    });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    await act(async () => {
      setHarnessCursorSymbol?.("MSFT");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    await act(async () => {
      setHarnessCursorSymbol?.("NVDA");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCommittedCursorSymbol).toBe("AAPL");

    await act(async () => {
      flushHarnessCursorSymbol?.("NVDA");
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(latestCommittedCursorSymbol).toBe("NVDA");
  });
});
