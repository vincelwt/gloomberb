import {
  normalizeFeedItems,
  normalizePostDetail,
  normalizeSubscriptions,
  sortSubscriptionsByLatest,
} from "../normalize";
import type {
  SubstackArticleSummary,
  SubstackPublication,
} from "../types";
import { SubstackAuthError, type SubstackCachedData, type SubstackHomeData, type SubstackPublicationFeedPage } from "./types";
import { publicationCacheKey } from "./cache";
import {
  fetchJsonAuthenticated,
  loadCachedResource,
  requireAuth,
  SUBSTACK_ORIGIN,
} from "./store";

const READER_FEED_TARGET_ITEMS = 50;
const READER_FEED_MAX_PAGES = 12;
const PUBLICATION_ARCHIVE_PAGE_LIMIT = 12;

export async function loadSubstackHome(force = false): Promise<SubstackHomeData> {
  const auth = requireAuth();
  const [subscriptionsEntry, feedEntry] = await Promise.all([
    loadCachedResource("subscriptions", "me", force, async () => {
      const payload = await fetchJsonAuthenticated<unknown>(`${SUBSTACK_ORIGIN}/api/v1/subscriptions/page_v2`, auth);
      return normalizeSubscriptions(payload);
    }),
    loadCachedResource("feed", "subscribed", force, async () => {
      return fetchReaderFeedItems(auth, "subscribed");
    }),
  ]);
  return {
    subscriptions: sortSubscriptionsByLatest(subscriptionsEntry.data, feedEntry.data),
    feed: feedEntry.data,
    fetchedAt: Math.max(subscriptionsEntry.fetchedAt, feedEntry.fetchedAt),
    stale: subscriptionsEntry.stale || feedEntry.stale,
  };
}

function payloadCursor(payload: unknown): string | null {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const cursor = record?.nextCursor ?? record?.next_cursor;
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

async function fetchReaderFeedItems(auth: ReturnType<typeof requireAuth>, tab: string): Promise<SubstackArticleSummary[]> {
  const collected = new Map<string, SubstackArticleSummary>();
  let cursor: string | null = null;
  for (let page = 0; page < READER_FEED_MAX_PAGES && collected.size < READER_FEED_TARGET_ITEMS; page += 1) {
    const url = new URL(`${SUBSTACK_ORIGIN}/api/v1/reader/feed`);
    url.searchParams.set("tab", tab);
    if (cursor) url.searchParams.set("cursor", cursor);
    const payload = await fetchJsonAuthenticated<unknown>(url.toString(), auth);
    for (const article of normalizeFeedItems(payload)) {
      collected.set(article.id, article);
      if (collected.size >= READER_FEED_TARGET_ITEMS) break;
    }
    const nextCursor = payloadCursor(payload);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return [...collected.values()];
}

export async function loadSubstackPublicationFeed(
  publication: SubstackPublication,
  force = false,
  offset = 0,
): Promise<SubstackCachedData<SubstackPublicationFeedPage>> {
  const auth = requireAuth();
  const baseUrl = publication.baseUrl;
  if (!baseUrl) {
    return {
      data: { items: [], nextOffset: null, hasMore: false },
      fetchedAt: Date.now(),
      stale: false,
    };
  }
  return loadCachedResource("publication", publicationCacheKey(publication, offset), force, async () => {
    const url = new URL("/api/v1/archive", baseUrl);
    url.searchParams.set("sort", "new");
    url.searchParams.set("limit", String(PUBLICATION_ARCHIVE_PAGE_LIMIT));
    if (offset > 0) url.searchParams.set("offset", String(offset));
    const payload = await fetchJsonAuthenticated<unknown>(url.toString(), auth);
    const items = normalizeFeedItems(payload, publication);
    const hasMore = items.length >= PUBLICATION_ARCHIVE_PAGE_LIMIT;
    return {
      items,
      nextOffset: hasMore ? offset + PUBLICATION_ARCHIVE_PAGE_LIMIT : null,
      hasMore,
    };
  });
}

function detailCandidateUrls(article: SubstackArticleSummary): string[] {
  const urls: string[] = [];
  if (/^\d+$/.test(article.id)) {
    urls.push(new URL(`/api/v1/posts/by-id/${article.id}`, SUBSTACK_ORIGIN).toString());
  }
  const baseUrl = article.publicationBaseUrl
    ?? (article.url ? new URL(article.url).origin : null);
  if (baseUrl) {
    if (/^\d+$/.test(article.id)) {
      urls.push(new URL(`/api/v1/posts/by-id/${article.id}`, baseUrl).toString());
    }
    if (article.slug) {
      urls.push(new URL(`/api/v1/posts/${article.slug}`, baseUrl).toString());
    }
    if (article.url) {
      try {
        const pathSlug = new URL(article.url).pathname.match(/\/p\/([^/?#]+)/)?.[1];
        if (pathSlug) urls.push(new URL(`/api/v1/posts/${decodeURIComponent(pathSlug)}`, baseUrl).toString());
      } catch {
        // Ignore malformed article URLs; the direct post id/slug paths above still apply.
      }
    }
  }
  return [...new Set(urls)];
}

export async function loadSubstackArticleDetail(
  article: SubstackArticleSummary,
  force = false,
): Promise<SubstackCachedData<ReturnType<typeof normalizePostDetail>>> {
  const auth = requireAuth();
  return loadCachedResource("post", article.id, force, async () => {
    const urls = detailCandidateUrls(article);
    const errors: string[] = [];
    for (const url of urls) {
      try {
        const payload = await fetchJsonAuthenticated<unknown>(url, auth);
        return normalizePostDetail(payload, article);
      } catch (error) {
        if (error instanceof SubstackAuthError) throw error;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (article.bodyHtml || urls.length === 0) return normalizePostDetail(article, article);
    throw new Error(errors[0] ?? "Substack post content unavailable");
  });
}
