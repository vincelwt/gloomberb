import { describe, expect, test } from "bun:test";
import { extractArticleContent } from "./content";
import {
  articleMatchesPublication,
  normalizeFeedItems,
  normalizePostDetail,
  normalizeSubscriptions,
  sortSubscriptionsByLatest,
} from "./normalize";

describe("Substack article extraction", () => {
  test("keeps article structure while removing chrome and image-only links", () => {
    const attrs = JSON.stringify({
      url: "https://x.com/jukan05/status/2062809398284812532?s=46",
      full_text: "* Important: SK hynix has no plans to add any new NAND flash capacity.\n\n=&gt; Pure-play NAND manufacturers add capacity.",
      username: "jukan05",
      name: "Jukan @COMPUTEX",
      date: "2026-06-05T08:11:00.000Z",
      photos: [{ img_url: "https://pbs.substack.com/media/HKCSNYaa8AAq-06.jpg" }],
      quoted_tweet: {
        full_text: "[Exclusive] Jensen Huang asked Hynix to make more.",
        username: "jukan05",
      },
    }).replace(/"/g, "&quot;");
    const content = extractArticleContent(`
      <article>
        <script>window.bad = true</script>
        <h1>Ignored detail title</h1>
        <h2>Victory Giant: -11% as US weighs subsidies</h2>
        <p>We bought <a href="/p/company">$NVDA</a> after earnings.</p>
        <div class="twitter-embed" data-attrs="${attrs}" data-component-name="Twitter2ToDOM"></div>
        <blockquote>Seems very knee jerkish - subsidies seem very small.</blockquote>
        <figure>
          <a href="https://substackcdn.com/image/fetch/$s_!abc/f_auto,q_auto:good/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fchart.png">image</a>
          <img src="/company-card.png" alt="CQME chart" />
        </figure>
        <p>See <a href="https://example.com/report">the report</a>.</p>
      </article>
    `, {
      baseUrl: "https://collyerbridge.substack.com",
      title: "Ignored detail title",
    });

    expect(content.text).toContain("$NVDA");
    expect(content.text).toContain("Seems very knee jerkish");
    expect(content.text).not.toContain("Ignored detail title");
    expect(content.text).not.toContain("window.bad");
    expect(content.text).not.toContain("substackcdn.com/image/fetch");
    expect(content.imageUrls).toEqual(["https://collyerbridge.substack.com/company-card.png"]);
    expect(content.linkUrls).toEqual([
      "https://collyerbridge.substack.com/p/company",
      "https://example.com/report",
    ]);
    expect(content.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "embed",
      "quote",
      "image",
      "paragraph",
    ]);
    expect(content.blocks[2]).toEqual({
      type: "embed",
      kind: "tweet",
      text: "* Important: SK hynix has no plans to add any new NAND flash capacity.\n\n=> Pure-play NAND manufacturers add capacity.\n\nQuoted: [Exclusive] Jensen Huang asked Hynix to make more.",
      url: "https://x.com/jukan05/status/2062809398284812532?s=46",
      username: "jukan05",
      authorName: "Jukan @COMPUTEX",
      dateLabel: "Jun 5, 2026",
      imageUrls: ["https://pbs.substack.com/media/HKCSNYaa8AAq-06.jpg"],
    });
  });
});

describe("Substack feed normalization", () => {
  test("normalizes reader rows and orders subscriptions by newest matching post", () => {
    const subscriptions = normalizeSubscriptions({
      result: {
        subscriptions: [
          { id: "sa", publication_id: "a" },
          { id: "sb", publication_id: "b" },
        ],
        publicationMap: {
          a: { id: "a", name: "Alpha", base_url: "https://alpha.example" },
          b: { id: "b", name: "Beta", base_url: "https://beta.example" },
        },
      },
    });
    const feed = normalizeFeedItems({
      items: [
        {
          post: {
            id: "older",
            title: "Older",
            post_date: "2026-06-01T10:00:00Z",
            publication: { id: "a", name: "Alpha", base_url: "https://alpha.example" },
          },
        },
        {
          post: {
            id: "newer",
            title: "Semis and $NVDA",
            subtitle: "A quick note",
            post_date: "2026-06-05T10:00:00Z",
            canonical_url: "https://beta.example/p/nvda",
            slug: "nvda",
            wordcount: 560,
            publication: { id: "b", name: "Beta", base_url: "https://beta.example" },
          },
        },
      ],
    });

    const sorted = sortSubscriptionsByLatest(subscriptions, feed);
    expect(feed[1]).toMatchObject({
      id: "newer",
      title: "Semis and $NVDA",
      publicationName: "Beta",
      publicationBaseUrl: "https://beta.example",
      url: "https://beta.example/p/nvda",
      readMinutes: 3,
    });
    expect(sorted.map((publication) => publication.name)).toEqual(["Beta", "Alpha"]);
    expect(articleMatchesPublication(feed[1]!, sorted[0]!)).toBe(true);
  });

  test("merges fetched post body into an existing summary", () => {
    const summary = normalizeFeedItems({
      items: [
        {
          post: {
            id: 99,
            title: "Macro Links",
            post_date: "2026-06-05T10:00:00Z",
            publication: { id: "macro", name: "Macro", base_url: "https://macro.example" },
          },
        },
      ],
    })[0]!;

    const detail = normalizePostDetail({
      id: 99,
      title: "Macro Links",
      body_html: "<p>$SPY broke higher. <a href=\"/p/chart\">Chart</a></p>",
      publication: { id: "macro", name: "Macro", base_url: "https://macro.example" },
    }, summary);

    expect(detail.contentText).toContain("$SPY");
    expect(detail.linkUrls).toEqual(["https://macro.example/p/chart"]);
    expect(detail.contentBlocks).toEqual([
      { type: "paragraph", text: "$SPY broke higher. Chart" },
    ]);
    expect(detail.id).toBe("99");
  });
});
