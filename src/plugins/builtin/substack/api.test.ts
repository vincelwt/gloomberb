import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import {
  attachSubstackPersistence,
  resetSubstackPersistence,
  setSubstackFetchTransportForTests,
} from "./api/store";
import {
  completeSubstackMagicLink,
  completeSubstackOtpLogin,
  parseCookiesFromSetCookie,
  splitSetCookieHeader,
} from "./api/auth";
import {
  getCachedSubstackArticleDetail,
  getCachedSubstackHome,
  getCachedSubstackPublicationFeed,
} from "./api/cache";
import {
  loadSubstackArticleDetail,
  loadSubstackHome,
  loadSubstackPublicationFeed,
} from "./api/loaders";
import type { SubstackArticleSummary, SubstackPublication } from "./types";

const EMAIL = "reader@example.com";
const LOGIN_URL = "https://substack.com/login-token";

afterEach(() => {
  setSubstackFetchTransportForTests(null);
  resetSubstackPersistence();
});

function publication(overrides: Partial<SubstackPublication> = {}): SubstackPublication {
  return {
    id: "alpha",
    name: "Alpha Research",
    subdomain: null,
    baseUrl: "https://alpha.example",
    description: null,
    logoUrl: null,
    latestPublishedAt: null,
    ...overrides,
  };
}

function article(overrides: Partial<SubstackArticleSummary> = {}): SubstackArticleSummary {
  const pub = publication();
  return {
    id: "1",
    title: "Markets and $SPY",
    publicationId: pub.id,
    publicationName: pub.name,
    publicationSubdomain: pub.subdomain,
    publicationBaseUrl: pub.baseUrl,
    url: `${pub.baseUrl}/p/markets`,
    slug: "markets",
    publishedAt: "2026-06-05T10:00:00Z",
    subtitle: null,
    previewText: null,
    bodyHtml: null,
    imageUrls: [],
    wordCount: 220,
    readMinutes: 1,
    ...overrides,
  };
}

function installAuthenticatedTransport(
  handler: (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>,
): string[] {
  const requests: string[] = [];
  setSubstackFetchTransportForTests(async (url, init) => {
    requests.push(url);
    if (url === LOGIN_URL) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/reader",
          "set-cookie": "substack.sid=sid123; Path=/; HttpOnly",
        },
      });
    }
    if (url === "https://substack.com/reader") {
      return new Response("ok", { status: 200 });
    }
    return await handler(url, init) ?? new Response(`unexpected ${url}`, { status: 500 });
  });
  return requests;
}

describe("Substack auth", () => {
  test("parses combined cookie headers and follows OTP redirects for the session cookie", async () => {
    const headers = splitSetCookieHeader(
      "foo=bar; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, substack.sid=sid123; Path=/; HttpOnly, substack.lli=1; Path=/",
    );
    expect(parseCookiesFromSetCookie(headers).get("substack.sid")).toBe("sid123");

    attachSubstackPersistence(new MemoryPluginPersistence());
    const requests: string[] = [];
    setSubstackFetchTransportForTests(async (url, init) => {
      requests.push(url);
      if (url === "https://substack.com/api/v1/email-otp-login/complete") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ code: "123456", email: EMAIL });
        return Response.json({ redirect: "/reader" });
      }
      if (url === "https://substack.com/reader") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/home",
            "set-cookie": "substack.sid=sid789; Path=/; HttpOnly",
          },
        });
      }
      if (url === "https://substack.com/home") {
        return new Response("ok", {
          headers: { "set-cookie": "substack.lli=1; Path=/" },
        });
      }
      return new Response(`unexpected ${url}`, { status: 500 });
    });

    const auth = await completeSubstackOtpLogin("123456", EMAIL);

    expect(auth).toMatchObject({ sid: "sid789", lli: "1", email: EMAIL });
    expect(requests).toEqual([
      "https://substack.com/api/v1/email-otp-login/complete",
      "https://substack.com/reader",
      "https://substack.com/home",
    ]);
  });
});

describe("Substack cached data loading", () => {
  test("loads subscriptions plus paginated feed and reuses the cached result", async () => {
    attachSubstackPersistence(new MemoryPluginPersistence());
    const feedUrls: string[] = [];
    const requests = installAuthenticatedTransport((url) => {
      if (url === "https://substack.com/api/v1/subscriptions/page_v2") {
        return Response.json({
          result: {
            subscriptions: [{ id: "sub-alpha", publication_id: "alpha" }],
            publicationMap: {
              alpha: { id: "alpha", name: "Alpha Research", base_url: "https://alpha.example" },
            },
          },
        });
      }
      if (url.startsWith("https://substack.com/api/v1/reader/feed?")) {
        feedUrls.push(url);
        const parsed = new URL(url);
        return Response.json(parsed.searchParams.has("cursor")
          ? { items: [{ post: { id: "second", title: "Second", post_date: "2026-06-05T11:00:00Z", publication: { id: "alpha", name: "Alpha Research", base_url: "https://alpha.example" } } }] }
          : {
            items: [
              { type: "comment", comment: { id: 1, body: "not a post" } },
              { post: { id: "first", title: "First", post_date: "2026-06-05T10:00:00Z", publication: { id: "alpha", name: "Alpha Research", base_url: "https://alpha.example" } } },
            ],
            nextCursor: "cursor-2",
          });
      }
    });

    await completeSubstackMagicLink(LOGIN_URL, EMAIL);
    const first = await loadSubstackHome(false);
    const requestCountAfterFirstLoad = requests.length;
    const second = await loadSubstackHome(false);

    expect(first.subscriptions.map((item) => item.name)).toEqual(["Alpha Research"]);
    expect(first.feed.map((item) => item.id)).toEqual(["first", "second"]);
    expect(second.feed.map((item) => item.id)).toEqual(["first", "second"]);
    expect(feedUrls).toHaveLength(2);
    expect(new URL(feedUrls[1]!).searchParams.get("cursor")).toBe("cursor-2");
    expect(requests).toHaveLength(requestCountAfterFirstLoad);
  });

  test("hydrates cached home, merged publication pages, and article detail synchronously", () => {
    const persistence = new MemoryPluginPersistence();
    attachSubstackPersistence(persistence);
    const pub = publication({ name: "Alpha" });
    const firstArticle = article({ id: "1", title: "Archive one", publicationName: "Alpha" });
    const secondArticle = article({
      id: "2",
      title: "Archive two",
      publicationName: "Alpha",
      url: "https://alpha.example/p/archive-two",
      slug: "archive-two",
      publishedAt: "2026-06-04T10:00:00Z",
      readMinutes: 2,
      wordCount: 440,
    });
    const cacheOptions = { sourceKey: "substack", schemaVersion: 3 };

    persistence.seedResource("subscriptions", "me", [pub], cacheOptions);
    persistence.seedResource("feed", "subscribed", [firstArticle], cacheOptions);
    persistence.seedResource("publication", "https://alpha.example:offset:0", {
      items: [firstArticle],
      nextOffset: 12,
      hasMore: true,
    }, cacheOptions);
    persistence.seedResource("publication", "https://alpha.example:offset:12", {
      items: [secondArticle],
      nextOffset: null,
      hasMore: false,
    }, cacheOptions);
    persistence.seedResource("post", "1", {
      ...firstArticle,
      bodyHtml: "<p>Cached body</p>",
      contentText: "Cached body",
      contentBlocks: [{ type: "paragraph", text: "Cached body" }],
      linkUrls: [],
    }, cacheOptions);

    expect(getCachedSubstackHome()?.feed.map((item) => item.title)).toEqual(["Archive one"]);
    expect(getCachedSubstackPublicationFeed(pub)?.data.items.map((item) => item.title)).toEqual([
      "Archive one",
      "Archive two",
    ]);
    expect(getCachedSubstackArticleDetail({ id: "1" })?.data.contentText).toBe("Cached body");
  });
});

describe("Substack publication archive loading", () => {
  test("uses archive page limits and offset pagination", async () => {
    attachSubstackPersistence(new MemoryPluginPersistence());
    const requests = installAuthenticatedTransport((url) => {
      if (url === "https://alpha.example/api/v1/archive?sort=new&limit=12") {
        return Response.json(Array.from({ length: 12 }, (_, index) => ({
          id: index + 1,
          title: `Archive ${index + 1}`,
          post_date: "2026-06-05T10:00:00Z",
          slug: `archive-${index + 1}`,
        })));
      }
      if (url === "https://alpha.example/api/v1/archive?sort=new&limit=12&offset=12") {
        return Response.json(Array.from({ length: 3 }, (_, index) => ({
          id: index + 13,
          title: `Archive ${index + 13}`,
          post_date: "2026-06-05T10:00:00Z",
          slug: `archive-${index + 13}`,
        })));
      }
    });

    await completeSubstackMagicLink(LOGIN_URL, EMAIL);
    const first = await loadSubstackPublicationFeed(publication(), false);
    const second = await loadSubstackPublicationFeed(publication(), false, first.data.nextOffset ?? 0);

    expect(first.data).toMatchObject({ hasMore: true, nextOffset: 12 });
    expect(first.data.items).toHaveLength(12);
    expect(second.data.items.map((item) => item.id)).toEqual(["13", "14", "15"]);
    expect(second.data.hasMore).toBe(false);
    expect(requests).toContain("https://alpha.example/api/v1/archive?sort=new&limit=12");
    expect(requests).toContain("https://alpha.example/api/v1/archive?sort=new&limit=12&offset=12");
  });
});

describe("Substack article detail loading", () => {
  test("prefers the Substack origin post endpoint over custom-domain teaser content", async () => {
    attachSubstackPersistence(new MemoryPluginPersistence());
    const requests = installAuthenticatedTransport((url) => {
      if (url === "https://substack.com/api/v1/posts/by-id/42") {
        return Response.json({
          id: 42,
          title: "Full post",
          body_html: "<p>Preview.</p><p>Paid section with $NVDA and more detail.</p>",
          publication: { id: "alpha", name: "Alpha", base_url: "https://alpha.example" },
        });
      }
      if (url === "https://alpha.example/api/v1/posts/by-id/42") {
        return Response.json({
          id: 42,
          title: "Full post",
          body_html: "<p>Preview.</p>",
          publication: { id: "alpha", name: "Alpha", base_url: "https://alpha.example" },
        });
      }
    });

    await completeSubstackMagicLink(LOGIN_URL, EMAIL);
    const detail = await loadSubstackArticleDetail(article({
      id: "42",
      title: "Full post",
      url: "https://alpha.example/p/full-post",
      slug: "full-post",
      previewText: "Preview.",
      bodyHtml: "<p>Preview.</p>",
      wordCount: 1,
    }));

    expect(detail.data.contentText).toContain("Paid section");
    expect(detail.data.wordCount).toBeGreaterThan(1);
    expect(requests).toContain("https://substack.com/api/v1/posts/by-id/42");
    expect(requests).not.toContain("https://alpha.example/api/v1/posts/by-id/42");
  });
});
