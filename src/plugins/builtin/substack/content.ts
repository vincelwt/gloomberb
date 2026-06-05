import { decodeHtmlEntities } from "../../../utils/html-entities";
import type { ExtractedArticleContent, SubstackContentBlock } from "./types";
import {
  asRecord,
  extractAttribute,
  firstString,
  normalizeUrl,
  parseDateIso,
  rawStringValue,
  stringValue,
  uniqueStrings,
  type JsonRecord,
} from "./utils";

const WORDS_PER_MINUTE = 220;

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function estimateReadingMinutes(wordsOrText: number | string | null | undefined): number {
  const words = typeof wordsOrText === "number"
    ? wordsOrText
    : typeof wordsOrText === "string"
      ? wordCount(wordsOrText)
      : 0;
  return Math.max(1, Math.ceil(Math.max(0, words) / WORDS_PER_MINUTE));
}

function bestSrcsetUrl(srcset: string | null, baseUrl?: string | null): string | null {
  if (!srcset) return null;
  const candidates = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0] ?? "")
    .map((entry) => normalizeUrl(decodeHtmlEntities(entry), baseUrl))
    .filter((entry): entry is string => !!entry);
  return candidates.at(-1) ?? null;
}

export function extractImageUrlsFromHtml(html: string, baseUrl?: string | null): string[] {
  const urls: Array<string | null> = [];
  for (const match of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    urls.push(
      normalizeUrl(decodeHtmlEntities(extractAttribute(tag, "src") ?? ""), baseUrl),
      normalizeUrl(decodeHtmlEntities(extractAttribute(tag, "data-src") ?? ""), baseUrl),
      bestSrcsetUrl(decodeHtmlEntities(extractAttribute(tag, "srcset") ?? ""), baseUrl),
      bestSrcsetUrl(decodeHtmlEntities(extractAttribute(tag, "data-srcset") ?? ""), baseUrl),
    );
  }
  return uniqueStrings(urls);
}

interface ExtractedLink {
  url: string;
  label: string;
}

function extractLinksFromHtml(html: string, baseUrl?: string | null): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const url = normalizeUrl(decodeHtmlEntities(extractAttribute(tag, "href") ?? ""), baseUrl);
    if (!url) continue;
    const closeIndex = html.indexOf("</a>", match.index + tag.length);
    const label = closeIndex >= 0
      ? plainFragment(html.slice(match.index + tag.length, closeIndex))
      : url;
    links.push({ url, label: label || url });
  }
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function extractLinkUrlsFromHtml(html: string, baseUrl?: string | null): string[] {
  return extractLinksFromHtml(html, baseUrl).map((link) => link.url);
}

function plainFragment(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function textFragment(html: string, baseUrl?: string | null): string {
  const withReadableLinks = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_match, attrs: string, inner: string) => {
      const href = normalizeUrl(decodeHtmlEntities(extractAttribute(attrs, "href") ?? ""), baseUrl);
      const label = plainFragment(inner);
      if (label) return label;
      return href ?? "";
    },
  );
  return plainFragment(
    withReadableLinks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|blockquote|h[1-6]|li|tr|ul|ol)>/gi, "\n"),
  );
}

function normalizeArticleText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isSocialUrl(url: string | null | undefined): boolean {
  return !!url && /\b(?:twitter\.com|x\.com|t\.co)\b/i.test(url);
}

function twitterUsernameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\b(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/status\//i);
  return match?.[1] ?? null;
}

function socialEmbedUrl(links: ExtractedLink[]): string | null {
  return links.find((link) => isSocialUrl(link.url))?.url ?? null;
}

function isSocialEmbed(attrs: string, inner: string, links: ExtractedLink[]): boolean {
  return /twitter|tweet|x\.com/i.test(attrs)
    || /twitter-tweet|tweet|platform\.twitter|x\.com|twitter\.com/i.test(inner)
    || links.some((link) => isSocialUrl(link.url));
}

function formatTweetDateLabel(value: unknown): string | null {
  const parsed = parseDateIso(value);
  if (!parsed) return stringValue(value);
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isLikelyImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const decoded = decodeURIComponent(url);
  return /\/image\/fetch\//i.test(decoded)
    || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(decoded);
}

function textMatchesImageLink(text: string, links: ExtractedLink[], imageUrls: string[]): boolean {
  const normalizedText = normalizeArticleText(text);
  if (!normalizedText) return false;
  const directUrl = normalizeUrl(normalizedText);
  if (isLikelyImageUrl(directUrl)) return true;

  const imageLinkLabels = links
    .filter((link) => isLikelyImageUrl(link.url))
    .flatMap((link) => [link.label, link.url])
    .map(normalizeArticleText);
  if (imageLinkLabels.includes(normalizedText)) return true;

  return imageUrls.some((url) => normalizedText === url || normalizedText.includes(url));
}

function buildTweetEmbedBlock(
  text: string,
  links: ExtractedLink[],
  url: string | null,
): SubstackContentBlock {
  const sourceLink = links.find((link) => link.url === url) ?? links.find((link) => isSocialUrl(link.url));
  const dateLabel = sourceLink && sourceLink.label !== sourceLink.url ? sourceLink.label : null;
  let body = normalizeArticleText(text);
  if (dateLabel && body.endsWith(dateLabel)) {
    body = normalizeArticleText(body.slice(0, -dateLabel.length));
  }

  let username = twitterUsernameFromUrl(url);
  let authorName: string | null = null;
  const authorMatch = body.match(/\s+[\u2014-]\s*([^@\n]+?)\s*\(@([A-Za-z0-9_]{1,15})\)\s*$/);
  if (authorMatch?.index != null) {
    authorName = normalizeArticleText(authorMatch[1] ?? "") || null;
    username = username ?? authorMatch[2] ?? null;
    body = normalizeArticleText(body.slice(0, authorMatch.index));
  }

  return {
    type: "embed",
    kind: "tweet",
    text: body || "Tweet",
    url,
    username,
    authorName,
    dateLabel,
    imageUrls: [],
  };
}

function tweetTextFromRecord(record: JsonRecord | null): string | null {
  const raw = rawStringValue(record?.full_text) ?? rawStringValue(record?.text);
  if (!raw) return null;
  const withReadableLinks = raw.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_match, attrs: string, inner: string) => {
      const href = normalizeUrl(decodeHtmlEntities(extractAttribute(attrs, "href") ?? ""));
      const label = plainFragment(inner);
      if (label) return label;
      return href ?? "";
    },
  );
  return normalizeArticleText(decodeHtmlEntities(withReadableLinks)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function tweetImageUrlsFromRecord(record: JsonRecord | null): string[] {
  const photos = Array.isArray(record?.photos) ? record.photos : [];
  return uniqueStrings(photos.map((photo) => (
    normalizeUrl(firstString(asRecord(photo), ["img_url", "url", "src"]))
  )));
}

function tweetEmbedBlockFromAttrs(attrs: string): SubstackContentBlock | null {
  const rawAttrs = extractAttribute(attrs, "data-attrs");
  if (!rawAttrs) return null;
  let record: JsonRecord | null = null;
  try {
    record = asRecord(JSON.parse(decodeHtmlEntities(rawAttrs)));
  } catch {
    return null;
  }
  if (!record) return null;

  const url = normalizeUrl(firstString(record, ["url", "expanded_url"]));
  const quoted = asRecord(record.quoted_tweet);
  const text = [
    tweetTextFromRecord(record),
    tweetTextFromRecord(quoted) ? `Quoted: ${tweetTextFromRecord(quoted)}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    type: "embed",
    kind: "tweet",
    text: text || "Tweet",
    url,
    username: firstString(record, ["username"]) ?? twitterUsernameFromUrl(url),
    authorName: firstString(record, ["name"]),
    dateLabel: formatTweetDateLabel(record.date),
    imageUrls: tweetImageUrlsFromRecord(record),
  };
}

function pushTextBlock(
  blocks: SubstackContentBlock[],
  block: SubstackContentBlock,
): void {
  const text = "text" in block ? normalizeArticleText(block.text) : "";
  if ("text" in block && !text) return;
  const normalizedBlock = "text" in block ? { ...block, text } : block;
  const previous = blocks.at(-1);
  if (
    previous
    && "text" in previous
    && "text" in normalizedBlock
    && previous.type === normalizedBlock.type
    && previous.text === normalizedBlock.text
  ) {
    return;
  }
  blocks.push(normalizedBlock);
}

function stripDuplicateLeadingTitleFromBlocks(
  blocks: SubstackContentBlock[],
  title: string | null | undefined,
): SubstackContentBlock[] {
  const normalizedTitle = (title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedTitle) return blocks;
  const index = blocks.findIndex((block) => "text" in block && block.text.trim().length > 0);
  if (index < 0) return blocks;
  const block = blocks[index]!;
  if (!("text" in block)) return blocks;
  const firstText = block.text.replace(/\s+/g, " ").trim().toLowerCase();
  if (firstText !== normalizedTitle) return blocks;
  return [...blocks.slice(0, index), ...blocks.slice(index + 1)];
}

function articleTextFromBlocks(blocks: SubstackContentBlock[]): string {
  return normalizeArticleText(blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "paragraph":
        case "quote":
        case "listItem":
          return block.text;
        case "embed":
          return [block.text, block.url].filter(Boolean).join("\n");
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n"));
}

function imageBlocksFromHtml(
  html: string,
  baseUrl: string | null,
  seenImages: Set<string>,
): SubstackContentBlock[] {
  const blocks: SubstackContentBlock[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const url = normalizeUrl(decodeHtmlEntities(extractAttribute(tag, "src") ?? ""), baseUrl)
      ?? normalizeUrl(decodeHtmlEntities(extractAttribute(tag, "data-src") ?? ""), baseUrl)
      ?? bestSrcsetUrl(decodeHtmlEntities(extractAttribute(tag, "srcset") ?? ""), baseUrl)
      ?? bestSrcsetUrl(decodeHtmlEntities(extractAttribute(tag, "data-srcset") ?? ""), baseUrl);
    if (!url || seenImages.has(url)) continue;
    seenImages.add(url);
    blocks.push({
      type: "image",
      url,
      alt: stringValue(extractAttribute(tag, "alt")),
    });
  }
  return blocks;
}

export function extractArticleContentBlocks(
  bodyHtml: string | null | undefined,
  options: { baseUrl?: string | null; imageUrls?: string[]; title?: string | null } = {},
): SubstackContentBlock[] {
  const baseUrl = options.baseUrl ?? null;
  const html = (bodyHtml ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  const blocks: SubstackContentBlock[] = [];
  const seenImages = new Set<string>();
  const blockPattern = /<div\b(?=[^>]*twitter-embed)([\s\S]*?)>\s*<\/div>|<(h[1-6]|p|blockquote|li|figure|iframe)\b([^>]*)>([\s\S]*?)<\/\2>|<(img|hr)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(html)) !== null) {
    const twitterAttrs = match[1] ?? "";
    const pairedTag = match[2]?.toLowerCase();
    const selfClosingTag = match[5]?.toLowerCase();
    const tag = twitterAttrs ? "twitterEmbed" : pairedTag ?? selfClosingTag;
    const attrs = twitterAttrs || match[3] || match[6] || "";
    const inner = match[4] ?? "";

    if (!tag) continue;

    if (tag === "twitterEmbed") {
      const tweetBlock = tweetEmbedBlockFromAttrs(attrs);
      if (tweetBlock) pushTextBlock(blocks, tweetBlock);
      continue;
    }

    if (tag === "img") {
      for (const block of imageBlocksFromHtml(match[0], baseUrl, seenImages)) blocks.push(block);
      continue;
    }
    if (tag === "hr") {
      if (blocks.at(-1)?.type !== "divider") blocks.push({ type: "divider" });
      continue;
    }
    if (tag === "iframe") {
      const src = normalizeUrl(decodeHtmlEntities(extractAttribute(attrs, "src") ?? ""), baseUrl);
      pushTextBlock(blocks, {
        type: "embed",
        kind: /youtube|youtu\.be|vimeo|video/i.test(src ?? "") ? "media" : "link",
        text: src ? "Embedded media" : "Embedded content",
        url: src,
      });
      continue;
    }

    const links = extractLinksFromHtml(inner, baseUrl);
    const text = textFragment(inner, baseUrl);

    if (tag === "figure") {
      const socialUrl = socialEmbedUrl(links);
      if (isSocialEmbed(attrs, inner, links)) {
        pushTextBlock(blocks, buildTweetEmbedBlock(text || "Tweet", links, socialUrl ?? links.at(-1)?.url ?? null));
        continue;
      }
      const imageUrls = extractImageUrlsFromHtml(inner, baseUrl);
      for (const block of imageBlocksFromHtml(inner, baseUrl, seenImages)) blocks.push(block);
      if (text && !textMatchesImageLink(text, links, imageUrls)) {
        pushTextBlock(blocks, { type: "paragraph", text });
      }
      continue;
    }

    if (tag.startsWith("h")) {
      const level = Number(tag.slice(1));
      pushTextBlock(blocks, { type: "heading", level, text });
      continue;
    }
    if (tag === "blockquote") {
      const socialUrl = socialEmbedUrl(links);
      pushTextBlock(blocks, isSocialEmbed(attrs, inner, links)
        ? buildTweetEmbedBlock(text || "Tweet", links, socialUrl ?? links.at(-1)?.url ?? null)
        : { type: "quote", text });
      continue;
    }
    if (tag === "li") {
      pushTextBlock(blocks, { type: "listItem", text });
      continue;
    }

    if (text && textMatchesImageLink(text, links, [])) {
      continue;
    }
    if (links.length === 1 && text && text === links[0]!.label && links[0]!.url !== text) {
      pushTextBlock(blocks, { type: "embed", kind: "link", text, url: links[0]!.url });
      continue;
    }
    pushTextBlock(blocks, { type: "paragraph", text });
  }

  if (blocks.length === 0) {
    const fallback = normalizeArticleText(textFragment(html, baseUrl));
    if (fallback) {
      for (const paragraph of fallback.split(/\n{2,}/)) {
        pushTextBlock(blocks, { type: "paragraph", text: paragraph });
      }
    }
  }

  for (const url of options.imageUrls ?? []) {
    const normalized = normalizeUrl(url, baseUrl);
    if (!normalized || seenImages.has(normalized)) continue;
    seenImages.add(normalized);
    blocks.push({ type: "image", url: normalized, alt: null });
  }

  return stripDuplicateLeadingTitleFromBlocks(blocks, options.title);
}

export function extractArticleContent(
  bodyHtml: string | null | undefined,
  options: { baseUrl?: string | null; imageUrls?: string[]; title?: string | null } = {},
): ExtractedArticleContent {
  const html = bodyHtml ?? "";
  const baseUrl = options.baseUrl ?? null;
  const imageUrls = uniqueStrings([
    ...(options.imageUrls ?? []),
    ...extractImageUrlsFromHtml(html, baseUrl),
  ].map((url) => normalizeUrl(url, baseUrl)));
  const linkUrls = extractLinkUrlsFromHtml(html, baseUrl).filter((url) => !isLikelyImageUrl(url));
  const blocks = extractArticleContentBlocks(bodyHtml, options);
  const text = stripDuplicateLeadingTitle(articleTextFromBlocks(blocks), options.title);
  const words = wordCount(text);
  return {
    text,
    blocks,
    imageUrls,
    linkUrls,
    wordCount: words,
    readMinutes: estimateReadingMinutes(words),
  };
}

function stripDuplicateLeadingTitle(text: string, title: string | null | undefined): string {
  const normalizedTitle = (title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedTitle || !text) return text;
  const lines = text.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return text;
  const firstLine = lines[firstContentIndex]!.replace(/\s+/g, " ").trim().toLowerCase();
  if (firstLine !== normalizedTitle) return text;
  const nextLines = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)];
  return normalizeArticleText(nextLines.join("\n"));
}
