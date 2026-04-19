import { useExternalLinkFooter, type PaneFooterSegment } from "../../../components";

export interface NewsFooterArticle {
  source?: string | null;
  url?: string | null;
}

interface UseNewsArticleFooterOptions {
  registrationId: string;
  focused: boolean;
  article: NewsFooterArticle | null | undefined;
  info?: PaneFooterSegment[];
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
}: UseNewsArticleFooterOptions) {
  useExternalLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info,
  });
}
