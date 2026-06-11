import { useCallback, useMemo } from "react";
import { usePluginState } from "../../../runtime";
import {
  DEFAULT_MAX_READ_IDS,
  markReadId,
  normalizeReadIds,
  sameStringArray,
} from "../../shared/read-state";

export interface NewsReadState {
  articleIds: string[];
}

const NEWS_READ_STATE_SCHEMA_VERSION = 1;
export const MAX_READ_ARTICLE_IDS = DEFAULT_MAX_READ_IDS;

const READ_STATE_KEY = "read-articles";
const EMPTY_READ_STATE: NewsReadState = { articleIds: [] };

export function normalizeNewsReadState(state: NewsReadState): NewsReadState {
  return { articleIds: normalizeReadIds(state.articleIds, MAX_READ_ARTICLE_IDS) };
}

export function markNewsArticleRead(
  state: NewsReadState,
  articleId: string,
): NewsReadState {
  const current = normalizeNewsReadState(state).articleIds;
  const articleIds = markReadId(current, articleId, MAX_READ_ARTICLE_IDS);

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
