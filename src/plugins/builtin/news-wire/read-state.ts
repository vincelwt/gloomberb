import { useCallback, useMemo } from "react";
import { usePluginState } from "../../plugin-runtime";

export interface NewsReadState {
  articleIds: string[];
}

export const NEWS_READ_STATE_SCHEMA_VERSION = 1;
export const MAX_READ_ARTICLE_IDS = 2_000;

const READ_STATE_KEY = "read-articles";
const EMPTY_READ_STATE: NewsReadState = { articleIds: [] };

function normalizeArticleId(articleId: string): string {
  return articleId.trim();
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function normalizeNewsReadState(state: NewsReadState): NewsReadState {
  const seen = new Set<string>();
  const articleIds: string[] = [];

  for (const rawId of state.articleIds) {
    if (typeof rawId !== "string") continue;
    const articleId = normalizeArticleId(rawId);
    if (!articleId || seen.has(articleId)) continue;
    seen.add(articleId);
    articleIds.push(articleId);
    if (articleIds.length >= MAX_READ_ARTICLE_IDS) break;
  }

  return { articleIds };
}

export function markNewsArticleRead(
  state: NewsReadState,
  articleId: string,
): NewsReadState {
  const normalizedId = normalizeArticleId(articleId);
  const current = normalizeNewsReadState(state).articleIds;
  if (!normalizedId) {
    return sameStringArray(current, state.articleIds) ? state : { articleIds: current };
  }

  const articleIds = [
    normalizedId,
    ...current.filter((currentId) => currentId !== normalizedId),
  ].slice(0, MAX_READ_ARTICLE_IDS);

  return sameStringArray(articleIds, state.articleIds) ? state : { articleIds };
}

export function useNewsReadState() {
  const [readState, setReadState] = usePluginState<NewsReadState>(
    READ_STATE_KEY,
    EMPTY_READ_STATE,
    { schemaVersion: NEWS_READ_STATE_SCHEMA_VERSION },
  );
  const normalizedReadState = useMemo(
    () => normalizeNewsReadState(readState),
    [readState],
  );
  const readArticleIds = useMemo(
    () => new Set(normalizedReadState.articleIds),
    [normalizedReadState],
  );
  const markArticleRead = useCallback((articleId: string) => {
    setReadState((current) => markNewsArticleRead(current, articleId));
  }, [setReadState]);

  return { readArticleIds, markArticleRead };
}
