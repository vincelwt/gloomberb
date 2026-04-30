import type { DataProvider } from "./data-provider";
import type { NewsArticle, NewsQuery } from "../news/types";
import type { CachePolicyMap } from "./persistence";

export interface DataSourceNewsCapability {
  supports?(query: NewsQuery): boolean;
  getCachedNews?(query: NewsQuery): NewsArticle[];
  fetchNews(query: NewsQuery): Promise<NewsArticle[]>;
}

export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;
  readonly cachePolicy?: CachePolicyMap;
  isEnabled?(): boolean;
  readonly market?: DataProvider;
  readonly news?: DataSourceNewsCapability;
}

export function sourcePriority(source: Pick<DataSource, "priority">): number {
  return source.priority ?? 1000;
}
