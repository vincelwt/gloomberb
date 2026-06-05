import {
  estimateReadingMinutes,
  extractArticleContent,
  wordCount,
} from "./content";
import type {
  SubstackArticleDetail,
  SubstackArticleSummary,
  SubstackPublication,
} from "./types";
import {
  asRecord,
  firstNumber,
  firstRawString,
  firstRecord,
  firstString,
  firstValue,
  maxIso,
  normalizeUrl,
  parseDateIso,
  timestamp,
  uniqueStrings,
  type JsonRecord,
} from "./utils";

function extractPayloadArray(payload: unknown, preferredKeys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of preferredKeys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  const data = asRecord(record.data);
  if (data) {
    for (const key of preferredKeys) {
      const value = data[key];
      if (Array.isArray(value)) return value;
    }
  }
  const result = asRecord(record.result);
  if (result) {
    for (const key of preferredKeys) {
      const value = result[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

export function normalizePublication(raw: unknown): SubstackPublication | null {
  const record = asRecord(raw);
  if (!record) return null;
  const subdomain = firstString(record, ["subdomain", "handle", "slug"]);
  const customDomain = firstString(record, ["custom_domain", "customDomain", "domain"]);
  const baseUrl = normalizeUrl(firstRawString(record, ["base_url", "baseUrl", "url", "web_url", "canonical_url"]))
    ?? (customDomain ? `https://${customDomain}` : null)
    ?? (subdomain ? `https://${subdomain}.substack.com` : null);
  const idValue = firstValue(record, ["id", "publication_id", "publicationId", "subdomain"]);
  const name = firstString(record, ["name", "publication_name", "publicationName", "title"]) ?? subdomain ?? "Substack";
  const id = String(idValue ?? baseUrl ?? name).trim();
  return {
    id,
    name,
    subdomain,
    baseUrl,
    description: firstString(record, ["description", "hero_text", "heroText", "author_bio"]),
    logoUrl: normalizeUrl(firstRawString(record, ["logo_url", "logoUrl", "logo", "cover_image", "coverImage"]), baseUrl),
    latestPublishedAt: parseDateIso(firstValue(record, [
      "latestPublishedAt",
      "last_published_at",
      "last_post_date",
      "lastPostDate",
      "updated_at",
    ])),
  };
}

export function normalizeSubscriptions(payload: unknown): SubstackPublication[] {
  const rows = extractPayloadArray(payload, [
    "subscriptions",
    "publications",
    "results",
    "items",
  ]);
  const rootRecord = asRecord(payload);
  const publicationLookup = buildPublicationLookup(rootRecord);
  const deduped = new Map<string, SubstackPublication>();
  for (const row of rows) {
    const record = asRecord(row);
    const publication = normalizePublication(
      record?.publication
        ?? record?.pub
        ?? (record ? publicationLookup.get(String(record.publication_id ?? record.publicationId ?? "")) : null)
        ?? row,
    );
    if (!publication) continue;
    const key = publicationKey(publication);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, publication);
      continue;
    }
    deduped.set(key, {
      ...existing,
      latestPublishedAt: maxIso(existing.latestPublishedAt, publication.latestPublishedAt),
    });
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildPublicationLookup(record: JsonRecord | null): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  if (!record) return lookup;
  const maps = [
    asRecord(record.publicationMap),
    asRecord(record.publication_map),
    asRecord(asRecord(record.result)?.publicationMap),
    asRecord(asRecord(record.result)?.publication_map),
  ];
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      lookup.set(key, value);
    }
  }
  const arrays = [
    record.publications,
    asRecord(record.result)?.publications,
  ];
  for (const array of arrays) {
    if (!Array.isArray(array)) continue;
    for (const publication of array) {
      const normalized = normalizePublication(publication);
      if (!normalized) continue;
      lookup.set(normalized.id, publication);
    }
  }
  return lookup;
}

function articlePostRecord(row: unknown): JsonRecord | null {
  const record = asRecord(row);
  return firstRecord(
    record?.post,
    record?.item,
    record?.entity,
    record?.object,
    record,
  );
}

function articlePublicationRecord(row: JsonRecord | null, post: JsonRecord | null): JsonRecord | null {
  return firstRecord(
    post?.publication,
    post?.pub,
    row?.publication,
    row?.pub,
  );
}

function buildArticleUrl(post: JsonRecord | null, publication: SubstackPublication | null): string | null {
  const direct = normalizeUrl(firstRawString(post, ["canonical_url", "canonicalUrl", "url", "web_url"]), publication?.baseUrl);
  if (direct) return direct;
  const slug = firstString(post, ["slug"]);
  if (!slug || !publication?.baseUrl) return null;
  return normalizeUrl(`/p/${slug}`, publication.baseUrl);
}

function normalizeArticle(row: unknown, sourcePublication?: SubstackPublication | null): SubstackArticleSummary | null {
  const rowRecord = asRecord(row);
  const post = articlePostRecord(row);
  if (!post) return null;
  const publication = normalizePublication(articlePublicationRecord(rowRecord, post)) ?? sourcePublication ?? null;
  const title = firstString(post, ["title", "name", "social_title", "email_subject"]) ?? firstString(rowRecord, ["title"]);
  const subtitle = firstString(post, ["subtitle", "description", "search_engine_description", "social_description"]);
  const bodyHtml = firstRawString(post, ["body_html", "bodyHtml", "body"]);
  const coverImage = normalizeUrl(firstRawString(post, [
    "cover_image",
    "coverImage",
    "cover_image_url",
    "coverImageUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "image",
  ]), publication?.baseUrl);
  const extracted = bodyHtml
    ? extractArticleContent(bodyHtml, { baseUrl: publication?.baseUrl, imageUrls: coverImage ? [coverImage] : [], title })
    : { text: "", blocks: [], imageUrls: uniqueStrings([coverImage]), linkUrls: [], wordCount: 0, readMinutes: 1 };
  const previewText = firstString(post, [
    "truncated_body_text",
    "body_preview",
    "preview",
    "subtitle",
    "description",
    "search_engine_description",
  ]) ?? (extracted.text ? extracted.text.slice(0, 500) : null);
  const rawWordCount = firstNumber(post, ["wordcount", "word_count", "words"]);
  const words = Math.max(0, Math.round(rawWordCount ?? extracted.wordCount ?? wordCount(previewText ?? "")));
  const rawReadMinutes = firstNumber(post, [
    "reading_time_minutes",
    "read_time_minutes",
    "readMinutes",
    "readingTime",
  ]);
  const publishedAt = parseDateIso(firstValue(post, [
    "post_date",
    "published_at",
    "publish_date",
    "date",
    "created_at",
    "updated_at",
  ]) ?? firstValue(rowRecord, ["published_at", "timestamp", "date"]));
  const url = buildArticleUrl(post, publication);
  const slug = firstString(post, ["slug"]);
  const rawId = firstValue(post, ["id", "post_id", "postId", "canonical_slug"]) ?? firstValue(rowRecord, ["id", "post_id"]);
  const id = String(rawId ?? url ?? `${publication?.id ?? "substack"}:${slug ?? title ?? publishedAt ?? Math.random()}`).trim();

  if (!title && !url && !bodyHtml) return null;

  return {
    id,
    title: title ?? "Untitled",
    publicationId: publication?.id ?? null,
    publicationName: publication?.name ?? null,
    publicationSubdomain: publication?.subdomain ?? null,
    publicationBaseUrl: publication?.baseUrl ?? null,
    url,
    slug,
    publishedAt,
    subtitle,
    previewText,
    bodyHtml,
    imageUrls: extracted.imageUrls,
    wordCount: words,
    readMinutes: rawReadMinutes != null ? Math.max(1, Math.ceil(rawReadMinutes)) : estimateReadingMinutes(words || extracted.text),
  };
}

export function normalizeFeedItems(payload: unknown, sourcePublication?: SubstackPublication | null): SubstackArticleSummary[] {
  const rows = extractPayloadArray(payload, ["items", "posts", "results", "feed"]);
  const items = rows
    .map((row) => normalizeArticle(row, sourcePublication))
    .filter((row): row is SubstackArticleSummary => !!row);
  const deduped = new Map<string, SubstackArticleSummary>();
  for (const item of items) {
    const existing = deduped.get(item.id);
    if (!existing || timestamp(item.publishedAt) > timestamp(existing.publishedAt)) {
      deduped.set(item.id, item);
    }
  }
  return [...deduped.values()];
}

export function normalizePostDetail(
  payload: unknown,
  fallback: SubstackArticleSummary,
): SubstackArticleDetail {
  const post = articlePostRecord(payload) ?? asRecord(payload);
  const normalized = normalizeArticle(post ?? payload, {
    id: fallback.publicationId ?? fallback.publicationBaseUrl ?? fallback.publicationName ?? "substack",
    name: fallback.publicationName ?? "Substack",
    subdomain: fallback.publicationSubdomain,
    baseUrl: fallback.publicationBaseUrl,
    description: null,
    logoUrl: null,
    latestPublishedAt: null,
  }) ?? fallback;
  const bodyHtml = normalized.bodyHtml ?? fallback.bodyHtml;
  const extracted = extractArticleContent(bodyHtml, {
    baseUrl: normalized.publicationBaseUrl ?? fallback.publicationBaseUrl,
    imageUrls: uniqueStrings([...fallback.imageUrls, ...normalized.imageUrls]),
    title: normalized.title || fallback.title,
  });
  const contentText = extracted.text || normalized.previewText || fallback.previewText || "";
  const words = Math.max(normalized.wordCount, extracted.wordCount, wordCount(contentText));
  return {
    ...fallback,
    ...normalized,
    id: fallback.id,
    title: normalized.title || fallback.title,
    url: normalized.url ?? fallback.url,
    bodyHtml,
    imageUrls: uniqueStrings([...normalized.imageUrls, ...fallback.imageUrls, ...extracted.imageUrls]),
    contentText,
    contentBlocks: extracted.blocks,
    linkUrls: extracted.linkUrls,
    wordCount: words,
    readMinutes: estimateReadingMinutes(words || contentText),
  };
}

export function publicationKey(publication: Pick<SubstackPublication, "id" | "name" | "baseUrl" | "subdomain">): string {
  return (
    publication.baseUrl
      ?? publication.subdomain
      ?? publication.id
      ?? publication.name
  ).toLowerCase();
}

function articlePublicationKeys(article: SubstackArticleSummary): string[] {
  return uniqueStrings([
    article.publicationBaseUrl?.toLowerCase(),
    article.publicationSubdomain?.toLowerCase(),
    article.publicationId?.toLowerCase(),
    article.publicationName?.toLowerCase(),
  ]);
}

export function articleMatchesPublication(
  article: SubstackArticleSummary,
  publication: SubstackPublication,
): boolean {
  const keys = new Set(articlePublicationKeys(article));
  return [
    publication.baseUrl,
    publication.subdomain,
    publication.id,
    publication.name,
  ].some((value) => !!value && keys.has(value.toLowerCase()));
}

export function sortSubscriptionsByLatest(
  subscriptions: SubstackPublication[],
  feedItems: SubstackArticleSummary[],
): SubstackPublication[] {
  return [...subscriptions]
    .map((publication) => {
      const latestFeedAt = feedItems
        .filter((article) => articleMatchesPublication(article, publication))
        .reduce<string | null>((latest, article) => maxIso(latest, article.publishedAt), null);
      return {
        publication,
        latestAt: maxIso(publication.latestPublishedAt, latestFeedAt),
      };
    })
    .sort((a, b) => {
      const byDate = timestamp(b.latestAt) - timestamp(a.latestAt);
      return byDate !== 0 ? byDate : a.publication.name.localeCompare(b.publication.name);
    })
    .map((entry) => ({ ...entry.publication, latestPublishedAt: entry.latestAt }));
}
