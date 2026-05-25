import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  attachThirteenFApiPersistence,
  resetThirteenFApiPersistence,
} from "./api";
import { loadBrowserRows } from "./data";

afterEach(() => {
  setHttpFetchTransport(null);
  resetThirteenFApiPersistence();
});

describe("13F data cache", () => {
  test("reuses the built-in plugin resource cache across browser row loads", async () => {
    attachThirteenFApiPersistence(new MemoryPluginPersistence());
    let requestCount = 0;
    setHttpFetchTransport(async (url) => {
      requestCount += 1;
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/funds")) {
        return json([{ cik: "1364742", name: "BlackRock Inc." }]);
      }
      if (path.endsWith("/forms")) {
        return json([{
          accession_number: "0001364742-26-000001",
          cik: "1364742",
          period_of_report: "2026-03-31",
          filed_as_of_date: "2026-05-15",
          submission_type: "13F-HR",
          company_name: "BlackRock Inc.",
          table_value_total: 100,
          table_entry_total: 1,
        }]);
      }
      if (path.endsWith("/topfunds")) {
        return json([]);
      }
      return json([]);
    });

    const first = await loadBrowserRows("funds", "BlackRock");
    const second = await loadBrowserRows("funds", "BlackRock");

    expect(first.rows[0]?.name).toBe("BlackRock Inc.");
    expect(second.rows[0]?.name).toBe("BlackRock Inc.");
    expect(requestCount).toBe(3);
  });

  test("force refresh bypasses the plugin resource cache", async () => {
    attachThirteenFApiPersistence(new MemoryPluginPersistence());
    let requestCount = 0;
    setHttpFetchTransport(async (url) => {
      requestCount += 1;
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/funds")) {
        return json([{ cik: "1364742", name: "BlackRock Inc." }]);
      }
      return json([]);
    });

    await loadBrowserRows("funds", "BlackRock");
    await loadBrowserRows("funds", "BlackRock", undefined, { forceRefresh: true });

    expect(requestCount).toBe(6);
  });

  test("requests later fund pages with the Forms13F offset", async () => {
    const fundOffsets: number[] = [];
    setHttpFetchTransport(async (url) => {
      const requestUrl = new URL(String(url));
      const path = requestUrl.pathname;
      if (path.endsWith("/funds")) {
        fundOffsets.push(Number(requestUrl.searchParams.get("offset") ?? 0));
        return json([{ cik: "1364742", name: `BlackRock page ${fundOffsets.length}` }]);
      }
      return json([]);
    });

    const first = await loadBrowserRows("funds", "BlackRock");
    const second = await loadBrowserRows("funds", "BlackRock", undefined, { offset: first.nextOffset });

    expect(fundOffsets).toEqual([0, 1]);
    expect(first.nextOffset).toBe(1);
    expect(second.nextOffset).toBe(2);
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
