import type { NewsArticle, NewsQuery } from "../../news/types";
import type { CapabilityRouteSource } from "../../types/capability-route-source";
import { shouldLogProviderError } from "../provider-errors";

interface ProviderRouterNewsRoutesOptions {
  newsSourcesInPriorityOrder: () => CapabilityRouteSource[];
  logProviderError: (message: string) => void;
}

export class ProviderRouterNewsRoutes {
  constructor(private readonly options: ProviderRouterNewsRoutesOptions) {}

  async getNews(query: NewsQuery): Promise<NewsArticle[]> {
    const sources = this.options.newsSourcesInPriorityOrder()
      .filter((source) => source.news?.supports?.(query) ?? true);
    const feed = query.feed ?? (query.scope === "ticker" ? "ticker" : "latest");
    if (feed === "ticker") {
      let firstEmpty: NewsArticle[] | null = null;
      for (const source of sources) {
        try {
          const articles = await source.news!.fetchNews(query);
          if (articles.length > 0) return articles;
          firstEmpty ??= articles;
        } catch (error) {
          if (shouldLogProviderError(error)) {
            this.options.logProviderError(`${source.id} failed: ${error}`);
          }
        }
      }
      return firstEmpty ?? [];
    }

    const settled = await Promise.allSettled(sources.map((source) => source.news!.fetchNews(query)));
    return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
}
