import type { DataTableColumn } from "../../../components";

export const SUBSTACK_PANE_ID = "substack";
export const SUBSTACK_PLUGIN_ID = "substack";
export const SUBSTACK_FEED_TAB_ID = "feed";

export interface SubstackPublication {
  id: string;
  name: string;
  subdomain: string | null;
  baseUrl: string | null;
  description: string | null;
  logoUrl: string | null;
  latestPublishedAt: string | null;
}

export interface ExtractedArticleContent {
  text: string;
  blocks: SubstackContentBlock[];
  imageUrls: string[];
  linkUrls: string[];
  wordCount: number;
  readMinutes: number;
}

export type SubstackContentBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "listItem"; text: string }
  | { type: "image"; url: string; alt: string | null }
  | {
    type: "embed";
    kind: "tweet";
    text: string;
    url: string | null;
    username: string | null;
    authorName: string | null;
    dateLabel: string | null;
    imageUrls: string[];
  }
  | { type: "embed"; kind: "link" | "media"; text: string; url: string | null }
  | { type: "divider" };

export interface SubstackArticleSummary {
  id: string;
  title: string;
  publicationId: string | null;
  publicationName: string | null;
  publicationSubdomain: string | null;
  publicationBaseUrl: string | null;
  url: string | null;
  slug: string | null;
  publishedAt: string | null;
  subtitle: string | null;
  previewText: string | null;
  bodyHtml: string | null;
  imageUrls: string[];
  wordCount: number;
  readMinutes: number;
}

export interface SubstackArticleDetail extends SubstackArticleSummary {
  contentText: string;
  contentBlocks: SubstackContentBlock[];
  linkUrls: string[];
}

export type SubstackSortColumnId = "published" | "publication" | "title" | "read";
export type SubstackSortDirection = "asc" | "desc";
export type SubstackColumn = DataTableColumn & { id: SubstackSortColumnId };
