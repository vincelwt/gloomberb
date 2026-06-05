import { usePaneFooter } from "../../../components";
import type { SubstackAuthState } from "./api/types";
import {
  formatReadTime,
  formatWordCount,
} from "./table";
import {
  SUBSTACK_PANE_ID,
  type SubstackArticleSummary,
} from "./types";
import { cacheStatusLabel, type ActiveFeedState, type DetailState } from "./pane-state";

export function useSubstackPaneFooter({
  auth,
  detailOpen,
  activeFeedState,
  activeDetail,
  selectedArticle,
  refreshActive,
  openSelectedArticle,
}: {
  auth: SubstackAuthState | null;
  detailOpen: boolean;
  activeFeedState: ActiveFeedState;
  activeDetail: DetailState;
  selectedArticle: SubstackArticleSummary | null;
  refreshActive: () => void;
  openSelectedArticle: () => void;
}) {
  const statusLabel = cacheStatusLabel(activeFeedState.fetchedAt, activeFeedState.stale);
  const articleMetaLabel = detailOpen && selectedArticle
    ? [
      selectedArticle.publicationName,
      formatReadTime(activeDetail.data?.readMinutes ?? selectedArticle.readMinutes),
      formatWordCount(activeDetail.data?.wordCount ?? selectedArticle.wordCount),
    ].filter(Boolean).join("  |  ")
    : null;

  usePaneFooter(SUBSTACK_PANE_ID, () => ({
    info: [
      ...(!auth ? [{ id: "auth", parts: [{ text: "login required", tone: "warning" as const }] }] : []),
      ...(articleMetaLabel ? [{ id: "article-meta", parts: [{ text: articleMetaLabel, tone: "muted" as const }] }] : []),
      ...(activeFeedState.loading || activeFeedState.loadingMore ? [{ id: "loading", parts: [{ text: activeFeedState.loadingMore ? "loading more" : "loading", tone: "muted" as const }] }] : []),
      ...(activeDetail.loading && detailOpen ? [{ id: "detail-loading", parts: [{ text: "loading article", tone: "muted" as const }] }] : []),
      ...(statusLabel && auth ? [{ id: "cache", parts: [{ text: statusLabel, tone: activeFeedState.stale ? "warning" as const : "muted" as const }] }] : []),
      ...(activeFeedState.error ? [{ id: "error", parts: [{ text: activeFeedState.error, tone: "warning" as const }] }] : []),
      ...(activeDetail.error && detailOpen ? [{ id: "detail-error", parts: [{ text: activeDetail.error, tone: "warning" as const }] }] : []),
    ],
    hints: auth ? [
      { id: "refresh", key: "r", label: "efresh", onPress: refreshActive },
      { id: "open", key: "o", label: "pen", onPress: openSelectedArticle, disabled: !selectedArticle?.url },
    ] : [],
  }), [
    activeDetail.error,
    activeDetail.loading,
    activeDetail.data?.readMinutes,
    activeDetail.data?.wordCount,
    activeFeedState.error,
    activeFeedState.fetchedAt,
    activeFeedState.loading,
    activeFeedState.loadingMore,
    activeFeedState.stale,
    articleMetaLabel,
    auth,
    detailOpen,
    openSelectedArticle,
    refreshActive,
    selectedArticle?.url,
    statusLabel,
  ]);
}
