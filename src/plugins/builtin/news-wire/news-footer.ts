import { useCallback, useMemo } from "react";
import { useExternalLinkFooter, type PaneFooterSegment, type PaneHint } from "../../../components";
import { useShortcut } from "../../../react/input";
import { useRendererHost } from "../../../ui";
import { apiClient } from "../../../utils/api-client";

const CLOUD_UPGRADE_URL = "https://gloom.sh/cloud";

export interface NewsFooterArticle {
  source?: string | null;
  url?: string | null;
}

interface UseNewsArticleFooterOptions {
  registrationId: string;
  focused: boolean;
  article: NewsFooterArticle | null | undefined;
  info?: PaneFooterSegment[];
  hints?: PaneHint[];
}

function hasRealtimeNewsAccess(): boolean {
  const user = apiClient.getCurrentUser();
  return user?.emailVerified === true && user.plan === "pro";
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
  hints,
}: UseNewsArticleFooterOptions) {
  const rendererHost = useRendererHost();
  const hasRealtimeAccess = hasRealtimeNewsAccess();
  const openUpgrade = useCallback(() => {
    void rendererHost.openExternal(CLOUD_UPGRADE_URL);
  }, [rendererHost]);

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused || hasRealtimeAccess || key !== "u") return;
    event.stopPropagation();
    event.preventDefault();
    openUpgrade();
  }, { scope: `${registrationId}:news-upgrade` });

  const accessInfo = useMemo<PaneFooterSegment[]>(() => (
    hasRealtimeAccess
      ? [{
        id: "news-access",
        parts: [{ text: "realtime news", tone: "positive" }],
      }]
      : [{
        id: "news-access",
        onPress: openUpgrade,
        parts: [{ text: "delayed 12h, upgrade for realtime", tone: "warning" }],
      }]
  ), [hasRealtimeAccess, openUpgrade]);
  const upgradeHints = useMemo<PaneHint[]>(() => (
    hasRealtimeAccess ? [] : [{ id: "upgrade", key: "u", label: "pgrade", onPress: openUpgrade }]
  ), [hasRealtimeAccess, openUpgrade]);
  const footerInfo = useMemo(() => [...accessInfo, ...(info ?? [])], [accessInfo, info]);
  const footerHints = useMemo(() => [...upgradeHints, ...(hints ?? [])], [hints, upgradeHints]);

  useExternalLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    hints: footerHints,
  });
}
