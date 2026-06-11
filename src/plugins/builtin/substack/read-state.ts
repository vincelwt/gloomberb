import { useCallback, useMemo } from "react";
import { usePluginState } from "../../runtime";
import {
  DEFAULT_MAX_READ_IDS,
  markReadId,
  normalizeReadIds,
  sameStringArray,
} from "../shared/read-state";

export interface SubstackReadState {
  articleIds: string[];
}

const SUBSTACK_READ_STATE_SCHEMA_VERSION = 1;
const READ_STATE_KEY = "read-articles";
const EMPTY_READ_STATE: SubstackReadState = { articleIds: [] };

export const MAX_READ_SUBSTACK_ARTICLE_IDS = DEFAULT_MAX_READ_IDS;

export function normalizeSubstackReadState(state: SubstackReadState): SubstackReadState {
  return {
    articleIds: normalizeReadIds(state.articleIds, MAX_READ_SUBSTACK_ARTICLE_IDS),
  };
}

export function markSubstackArticleRead(
  state: SubstackReadState,
  articleId: string,
): SubstackReadState {
  const current = normalizeSubstackReadState(state).articleIds;
  const articleIds = markReadId(current, articleId, MAX_READ_SUBSTACK_ARTICLE_IDS);

  return sameStringArray(articleIds, state.articleIds) ? state : { articleIds };
}

export function useSubstackReadState() {
  const [readState, setReadState] = usePluginState<SubstackReadState>(
    READ_STATE_KEY,
    EMPTY_READ_STATE,
    { schemaVersion: SUBSTACK_READ_STATE_SCHEMA_VERSION },
  );
  const normalizedReadState = useMemo(
    () => normalizeSubstackReadState(readState),
    [readState],
  );
  const readArticleIds = useMemo(
    () => new Set(normalizedReadState.articleIds),
    [normalizedReadState],
  );
  const markArticleRead = useCallback((articleId: string) => {
    setReadState((current) => markSubstackArticleRead(current, articleId));
  }, [setReadState]);

  return { readArticleIds, markArticleRead };
}
