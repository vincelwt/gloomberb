import { describe, expect, test } from "bun:test";
import { resolveDesktopDeepLinkAction } from "./desktop-deeplink";

describe("desktop deeplinks", () => {
  test("routes cloud roundup links to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/roundup?week=2026-07-03")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-roundup", week: "2026-07-03" },
      message: "Opened weekly roundup settings for 2026-07-03.",
    });
  });

  test("routes cloud alert links to account management", () => {
    expect(resolveDesktopDeepLinkAction("gloomberb://cloud/alerts")).toEqual({
      type: "open-account-management",
      route: { kind: "cloud-alerts", week: null },
      message: "Opened portfolio alert settings.",
    });
  });

  test("rejects non-cloud and malformed links", () => {
    expect(resolveDesktopDeepLinkAction("https://gloom.sh/cloud").type).toBe("unsupported");
    expect(resolveDesktopDeepLinkAction("gloomberb://ticker/NVDA").type).toBe("unsupported");
    expect(resolveDesktopDeepLinkAction("not a url").type).toBe("unsupported");
  });
});
