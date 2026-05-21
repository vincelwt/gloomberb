import { describe, expect, test } from "bun:test";
import { parseRssFeed, type RssFeedConfig } from "./rss-parser";

const DEFAULT_CONFIG: RssFeedConfig = {
  id: "test-feed",
  url: "https://example.com/feed",
  name: "Test Feed",
  authority: 60,
  enabled: true,
};

const RSS2_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <item>
    <title>Fed holds rates steady</title>
    <link>https://example.com/fed-rates</link>
    <pubDate>Thu, 10 Apr 2026 14:30:00 GMT</pubDate>
    <description>&lt;p&gt;The Federal Reserve held rates steady at 4.25%.&lt;/p&gt;</description>
    <category>Economy</category>
  </item>
  <item>
    <title><![CDATA[NVIDIA beats Q1 estimates]]></title>
    <link>https://example.com/nvda-q1</link>
    <pubDate>Thu, 10 Apr 2026 10:00:00 GMT</pubDate>
    <description>NVIDIA reported strong earnings.</description>
  </item>
  <item>
    <title>Oil surges on OPEC cuts</title>
    <link>https://example.com/oil-opec</link>
    <pubDate>Thu, 10 Apr 2026 08:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Markets rally on trade deal</title>
    <link href="https://example.com/trade-deal"/>
    <published>2026-04-10T12:00:00Z</published>
    <summary>Global markets surged on news of a trade agreement.</summary>
  </entry>
</feed>`;

describe("parseRssFeed", () => {
  test("parses RSS items with normalized text, categories, source, dates, and stable ids", () => {
    const items = parseRssFeed(RSS2_FIXTURE, DEFAULT_CONFIG);
    const again = parseRssFeed(RSS2_FIXTURE, DEFAULT_CONFIG);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: "Fed holds rates steady",
      url: "https://example.com/fed-rates",
      source: "Test Feed",
      categories: ["Economy"],
    });
    expect(items[0]!.publishedAt).toBeInstanceOf(Date);
    expect(items[0]!.publishedAt.getFullYear()).toBe(2026);
    expect(items[0]!.summary).toContain("Federal Reserve");
    expect(items[0]!.summary).not.toContain("<p>");
    expect(items[0]!.summary).not.toContain("&lt;");
    expect(items[1]!.title).toBe("NVIDIA beats Q1 estimates");
    expect(items[2]).toMatchObject({
      title: "Oil surges on OPEC cuts",
      summary: undefined,
    });
    expect(items[0]!.id).toBe(again[0]!.id);
  });

  test("parses Atom entries", () => {
    const items = parseRssFeed(ATOM_FIXTURE, DEFAULT_CONFIG);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Markets rally on trade deal",
      url: "https://example.com/trade-deal",
    });
    expect(items[0]!.publishedAt).toBeInstanceOf(Date);
    expect(items[0]!.publishedAt.getMonth()).toBe(3);
    expect(items[0]!.summary).toContain("trade agreement");
  });

  test("ignores empty or invalid input", () => {
    expect(parseRssFeed("", DEFAULT_CONFIG)).toHaveLength(0);
    expect(parseRssFeed("not xml at all <<<", DEFAULT_CONFIG)).toHaveLength(0);
    expect(parseRssFeed("   \n\t  ", DEFAULT_CONFIG)).toHaveLength(0);
  });

  test("truncates long summaries and accepts title-only items", () => {
    const longDesc = "x".repeat(400);
    const xml = `<rss version="2.0"><channel>
      <item>
        <title>Long item</title>
        <link>https://example.com/long</link>
        <pubDate>Thu, 10 Apr 2026 08:00:00 GMT</pubDate>
        <description>${longDesc}</description>
      </item>
      <item><title>Titleonly item</title></item>
    </channel></rss>`;
    const items = parseRssFeed(xml, DEFAULT_CONFIG);

    expect(items).toHaveLength(2);
    expect(items[0]!.summary!.length).toBeLessThanOrEqual(301);
    expect(items[0]!.summary).toContain("…");
    expect(items[1]!.title).toBe("Titleonly item");
  });

  test("uses config category when the item has none", () => {
    const items = parseRssFeed(RSS2_FIXTURE, { ...DEFAULT_CONFIG, category: "markets" });

    expect(items[1]!.categories).toContain("markets");
  });
});
