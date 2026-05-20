import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Box, Input, ScrollBox, Text, TextAttributes, useRendererHost, type InputRenderable } from "../../ui";
import { useShortcut } from "../../react/input";
import {
  DataTableStackView,
  EmptyState,
  Tabs,
  TickerBadgeList,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../components";
import type { DetailTabProps, PaneProps } from "../../types/plugin";
import { usePaneInstance, usePaneInstanceId, usePaneTicker } from "../../state/app-context";
import { usePluginAppActions, usePluginPaneState, usePluginState } from "../plugin-runtime";
import { TickerBadgeText } from "../../components/ticker-badge-text";
import { RemoteImage } from "../../components/ui";
import { useInlineTickers } from "../../state/use-inline-tickers";
import { apiClient, type CloudTweetPayload, type CloudTweetQueryType, type CloudTweetSearchResponse } from "../../utils/api-client";
import { collectUniqueTickerSymbols } from "../../utils/ticker-tokenizer";
import { formatCompact, formatTimeAgo } from "../../utils/format";
import { normalizeTweetText } from "../../utils/tweet-text";
import { truncateWithEllipsis } from "../../utils/text-wrap";
import { toTimestampMillis } from "../../utils/timestamp";
import { normalizedHttpUrl } from "../../utils/url";
import { colors } from "../../theme/colors";
import { CloudAuthNotice } from "./cloud-auth-actions";

const DEFAULT_TWEET_HOURS = 6;
const DEFAULT_TWEET_LIMIT = 50;
const TWEET_SEARCH_SCHEMA_VERSION = 1;
const TWEET_SEARCH_DEBOUNCE_MS = 450;
const TWITTER_USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

export const TWITTER_FEED_PANE_ID = "twitter-feed";
export const TWITTER_FEED_LAUNCH_STATE_KEY = "twitter-feed-launch";
export const TWITTER_FEED_LAUNCH_SCHEMA_VERSION = 1;

type TweetColumnId = "time" | "author" | "text" | "tickers" | "likes" | "views";
type TweetColumn = DataTableColumn & { id: TweetColumnId };
type TweetSortColumnId = "time" | "likes" | "views";
type TweetSortDirection = "asc" | "desc";

interface TweetLoadState {
  data: CloudTweetSearchResponse | null;
  loading: boolean;
  error: string | null;
}

interface TwitterFeed {
  id: string;
  title: string;
  query: string;
  queryType: CloudTweetQueryType;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

interface PersistedTwitterFeedState {
  feeds: TwitterFeed[];
}

export interface TwitterFeedLaunchRequest {
  query: string;
  targetPaneId: string | null;
  nonce: string;
  createdAt: number;
  queryType?: CloudTweetQueryType;
}

const EMPTY_FEED_STATE: PersistedTwitterFeedState = { feeds: [] };
let nextTwitterFeedId = 1;

function generateFeedId(): string {
  return `${Date.now()}-${nextTwitterFeedId++}`;
}

function deriveFeedTitle(query: string): string {
  const tickers = collectUniqueTickerSymbols([query]);
  if (tickers.length > 0) return tickers.slice(0, 3).map((ticker) => `$${ticker}`).join(" ");
  return truncateWithEllipsis(query.replace(/\s+/g, " ").trim(), 24) || "New";
}

function createFeed(query: string, queryType: CloudTweetQueryType): TwitterFeed {
  const now = Date.now();
  return {
    id: generateFeedId(),
    title: deriveFeedTitle(query),
    query,
    queryType,
    createdAt: now,
    updatedAt: now,
    lastSuccessAt: null,
    lastError: null,
  };
}

function normalizeFeedQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTwitterUsername(username: string): string | null {
  const normalized = username.trim().replace(/^@/, "");
  return TWITTER_USERNAME_RE.test(normalized) ? normalized : null;
}

function twitterUserSearchQuery(username: string): string {
  return `from:${username}`;
}

function normalizeFeeds(value: unknown): TwitterFeed[] {
  const entries = Array.isArray((value as PersistedTwitterFeedState | undefined)?.feeds)
    ? (value as PersistedTwitterFeedState).feeds
    : [];
  return entries
    .filter((entry): entry is TwitterFeed => (
      !!entry
      && typeof entry === "object"
      && typeof entry.id === "string"
      && typeof entry.query === "string"
    ))
    .map((entry) => ({
      ...entry,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title : deriveFeedTitle(entry.query),
      queryType: entry.queryType === "Top" ? "Top" : "Latest",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
      lastSuccessAt: typeof entry.lastSuccessAt === "number" ? entry.lastSuccessAt : null,
      lastError: typeof entry.lastError === "string" ? entry.lastError : null,
    }));
}

function formatRelativeShort(value: string): string {
  return formatTimeAgo(value).replace(" ago", "").replace("just now", "<1m");
}

function formatMetric(value: number | null | undefined): string {
  if (value == null) return "-";
  if (Math.abs(value) >= 1000) return formatCompact(value);
  return String(value);
}

function normalizeTweetDisplayText(value: string): string {
  return normalizeTweetText(value, { preserveLineBreaks: true });
}

function normalizeTweetCellText(value: string): string {
  return normalizeTweetText(value);
}

function tweetTickers(tweet: CloudTweetPayload): string[] {
  return collectUniqueTickerSymbols([normalizeTweetDisplayText(tweet.text)]);
}

function tweetCreatedAtMs(tweet: CloudTweetPayload): number {
  const ms = toTimestampMillis(tweet.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  sortDirection: TweetSortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const comparison = left - right;
  return sortDirection === "asc" ? comparison : -comparison;
}

function isTweetSortColumnId(columnId: string): columnId is TweetSortColumnId {
  return columnId === "time" || columnId === "likes" || columnId === "views";
}

function compareTweets(
  left: CloudTweetPayload,
  right: CloudTweetPayload,
  sortColumnId: TweetSortColumnId,
  sortDirection: TweetSortDirection,
): number {
  let comparison = 0;
  switch (sortColumnId) {
    case "time":
      comparison = tweetCreatedAtMs(left) - tweetCreatedAtMs(right);
      if (comparison !== 0) {
        return sortDirection === "asc" ? comparison : -comparison;
      }
      break;
    case "likes":
      comparison = compareNullableNumber(left.metrics.likes, right.metrics.likes, sortDirection);
      break;
    case "views":
      comparison = compareNullableNumber(left.metrics.views, right.metrics.views, sortDirection);
      break;
  }

  if (comparison !== 0) return comparison;

  return tweetCreatedAtMs(right) - tweetCreatedAtMs(left);
}

function sortedTweets(
  tweets: CloudTweetPayload[],
  sortColumnId: TweetSortColumnId,
  sortDirection: TweetSortDirection,
): CloudTweetPayload[] {
  return [...tweets].sort((left, right) => compareTweets(left, right, sortColumnId, sortDirection));
}

function mediaImageUrl(value: unknown): string | null {
  const directUrl = normalizedHttpUrl(value);
  if (directUrl) return directUrl;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  return normalizedHttpUrl(record.mediaUrl)
    ?? normalizedHttpUrl(record.media_url_https)
    ?? normalizedHttpUrl(record.media_url)
    ?? normalizedHttpUrl(record.previewImageUrl)
    ?? normalizedHttpUrl(record.preview_image_url)
    ?? normalizedHttpUrl(record.url);
}

function nestedMedia(record: Record<string, unknown>, key: string): unknown {
  const value = record[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>).media : undefined;
}

function tweetImageUrls(tweet: CloudTweetPayload): string[] {
  const record = tweet as unknown as Record<string, unknown>;
  const candidates = [
    record.media,
    record.photos,
    record.images,
    nestedMedia(record, "entities"),
    nestedMedia(record, "extendedEntities"),
    nestedMedia(record, "extended_entities"),
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    const entries = Array.isArray(candidate) ? candidate : candidate == null ? [] : [candidate];
    for (const entry of entries) {
      const url = mediaImageUrl(entry);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function buildTweetColumns(width: number): TweetColumn[] {
  const timeWidth = 7;
  const authorWidth = 16;
  const tickersWidth = 24;
  const likesWidth = 7;
  const viewsWidth = 8;
  const textWidth = Math.max(
    20,
    width - timeWidth - authorWidth - tickersWidth - likesWidth - viewsWidth - 9,
  );
  return [
    { id: "time", label: "TIME", width: timeWidth, align: "left" },
    { id: "author", label: "AUTHOR", width: authorWidth, align: "left" },
    { id: "text", label: "TWEET", width: textWidth, align: "left" },
    { id: "tickers", label: "TICKERS", width: tickersWidth, align: "left" },
    { id: "likes", label: "LIKES", width: likesWidth, align: "right" },
    { id: "views", label: "VIEWS", width: viewsWidth, align: "right" },
  ];
}

function isAuthError(error: string | null): boolean {
  return !!error && /unauthorized|verification/i.test(error);
}

function TweetDetail({
  tweet,
  width,
  onOpenUsername,
}: {
  tweet: CloudTweetPayload;
  width: number;
  onOpenUsername: (username: string) => void;
}) {
  const lineWidth = Math.max(1, width - 2);
  const tweetText = normalizeTweetDisplayText(tweet.text);
  const imageUrls = tweetImageUrls(tweet);
  const imageWidth = Math.min(lineWidth, 72);
  const imageHeight = Math.max(6, Math.min(14, Math.floor(imageWidth * 0.35)));
  const { catalog, openTicker } = useInlineTickers([tweetText]);

  return (
    <ScrollBox scrollY focusable={false} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth} gap={1}>
        <TickerBadgeText
          text={tweetText}
          lineWidth={lineWidth}
          catalog={catalog}
          textColor={colors.text}
          openTicker={openTicker}
          openUsername={onOpenUsername}
        />
        {imageUrls.length > 0 ? (
          <Box flexDirection="column" gap={1}>
            {imageUrls.slice(0, 4).map((url, index) => (
              <RemoteImage
                key={url}
                src={url}
                alt={`Tweet image ${index + 1}`}
                width={imageWidth}
                height={imageHeight}
                label={imageUrls.length > 1 ? `image ${index + 1}` : "image"}
              />
            ))}
          </Box>
        ) : null}
        <Box flexDirection="row" height={1}>
          <Text fg={colors.textDim}>
            {`likes ${formatMetric(tweet.metrics.likes)}  reposts ${formatMetric(tweet.metrics.retweets)}  replies ${formatMetric(tweet.metrics.replies)}  views ${formatMetric(tweet.metrics.views)}`}
          </Text>
        </Box>
      </Box>
    </ScrollBox>
  );
}

function useTweetSearchData(
  requestKey: string,
  load: () => Promise<CloudTweetSearchResponse>,
  onResult?: (result: CloudTweetSearchResponse) => void,
  onError?: (message: string) => void,
  enabled = true,
) {
  const [state, setState] = useState<TweetLoadState>({
    data: null,
    loading: false,
    error: null,
  });
  const fetchGenRef = useRef(0);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  const reload = useCallback(() => {
    if (!enabled) {
      fetchGenRef.current += 1;
      setState((current) => (
        current.data || current.loading || current.error
          ? { data: null, loading: false, error: null }
          : current
      ));
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    load()
      .then((data) => {
        if (fetchGenRef.current !== gen) return;
        setState({ data, loading: false, error: null });
        onResultRef.current?.(data);
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ data: null, loading: false, error: message });
        onErrorRef.current?.(message);
      });
  }, [enabled, load]);

  useEffect(() => {
    reload();
  }, [reload, requestKey]);

  return { ...state, reload };
}

function TweetSearchTable({
  focused,
  width,
  height,
  requestKey,
  footerId,
  rootBefore,
  enabled = true,
  load,
  onResult,
  onError,
  emptyStateTitle,
  emptyStateHint,
}: {
  focused: boolean;
  width: number;
  height: number;
  requestKey: string;
  footerId: string;
  rootBefore?: ReactNode;
  enabled?: boolean;
  load: () => Promise<CloudTweetSearchResponse>;
  onResult?: (result: CloudTweetSearchResponse) => void;
  onError?: (message: string) => void;
  emptyStateTitle?: string;
  emptyStateHint?: string;
}) {
  const rendererHost = useRendererHost();
  const { createPaneFromTemplate } = usePluginAppActions();
  const { data, loading, error, reload } = useTweetSearchData(requestKey, load, onResult, onError, enabled);
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sort, setSort] = useState<{ columnId: TweetSortColumnId; direction: TweetSortDirection }>({
    columnId: "views",
    direction: "desc",
  });
  const rows = useMemo(() => sortedTweets(data?.tweets ?? [], sort.columnId, sort.direction), [data?.tweets, sort]);
  const columns = useMemo(() => buildTweetColumns(width), [width]);
  const tableTickerTexts = useMemo(() => {
    const seen = new Set<string>();
    const texts: string[] = [];
    for (const tweet of rows) {
      for (const symbol of tweetTickers(tweet)) {
        if (seen.has(symbol)) continue;
        seen.add(symbol);
        texts.push(`$${symbol}`);
      }
    }
    return texts;
  }, [rows]);
  const { catalog: tickerCatalog, openTicker } = useInlineTickers(tableTickerTexts);
  const selectedIndex = rows.findIndex((tweet) => tweet.id === selectedTweetId);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : rows.length > 0 ? 0 : -1;
  const selectedTweet = rows[activeIndex] ?? null;

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedTweetId !== null) setSelectedTweetId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedTweetId || selectedIndex < 0) {
      setSelectedTweetId(rows[0]!.id);
    }
  }, [rows, selectedIndex, selectedTweetId]);

  const openSelectedTweet = useCallback(() => {
    if (selectedTweet?.url) void rendererHost.openExternal(selectedTweet.url);
  }, [rendererHost, selectedTweet]);
  const openUsernameFeed = useCallback((username: string) => {
    const normalizedUsername = normalizeTwitterUsername(username);
    if (!normalizedUsername) return;
    const query = twitterUserSearchQuery(normalizedUsername);
    createPaneFromTemplate("twitter-feed-pane", {
      arg: query,
      values: {
        query,
        queryType: "Latest",
      },
    });
  }, [createPaneFromTemplate]);

  const handleHeaderClick = useCallback((columnId: string) => {
    if (!isTweetSortColumnId(columnId)) return;
    setSort((current) => (
      current.columnId === columnId
        ? { columnId, direction: current.direction === "desc" ? "asc" : "desc" }
        : { columnId, direction: "desc" }
    ));
  }, []);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    reload();
    return true;
  }, [reload]);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "o") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    openSelectedTweet();
    return true;
  }, [openSelectedTweet]);

  usePaneFooter(footerId, () => ({
    info: [
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
      ...(detailOpen ? [{ id: "open", key: "o", label: "pen", onPress: openSelectedTweet, disabled: !selectedTweet?.url }] : []),
    ],
  }), [detailOpen, error, footerId, loading, openSelectedTweet, reload, selectedTweet?.url]);

  const renderCell = useCallback((
    tweet: CloudTweetPayload,
    column: TweetColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "time":
        return { text: formatRelativeShort(tweet.createdAt), color: selectedColor ?? colors.textDim };
      case "author":
        return {
          text: `@${tweet.author.userName || tweet.author.name}`,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "text":
        return { text: normalizeTweetCellText(tweet.text), color: selectedColor ?? colors.text };
      case "tickers": {
        const tickers = tweetTickers(tweet);
        return {
          text: tickers.map((ticker) => `$${ticker}`).join(" "),
          content: (
            <TickerBadgeList
              symbols={tickers}
              width={column.width}
              catalog={tickerCatalog}
              fallbackColor={selectedColor ?? colors.positive}
              openTicker={openTicker}
            />
          ),
          color: selectedColor ?? colors.positive,
        };
      }
      case "likes":
        return { text: formatMetric(tweet.metrics.likes), color: selectedColor ?? colors.textDim };
      case "views":
        return { text: formatMetric(tweet.metrics.views), color: selectedColor ?? colors.textDim };
    }
  }, [openTicker, tickerCatalog]);

  const emptyContent = error && isAuthError(error)
    ? <CloudAuthNotice message={error} showSignup />
    : undefined;

  return (
    <DataTableStackView<CloudTweetPayload, TweetColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={() => setDetailOpen(false)}
      detailTitle={selectedTweet ? `@${selectedTweet.author.userName || selectedTweet.author.name} - ${formatTimeAgo(selectedTweet.createdAt)}` : "Tweet"}
      detailContent={selectedTweet ? <TweetDetail tweet={selectedTweet} width={width} onOpenUsername={openUsernameFeed} /> : null}
      selectedIndex={activeIndex}
      onSelectIndex={(index) => setSelectedTweetId(rows[index]?.id ?? null)}
      onActivateIndex={(index) => {
        const tweet = rows[index];
        if (!tweet) return;
        setSelectedTweetId(tweet.id);
        setDetailOpen(true);
      }}
      onRootKeyDown={handleRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(tweet) => tweet.id}
      isSelected={(tweet) => tweet.id === selectedTweetId}
      onSelect={(tweet) => setSelectedTweetId(tweet.id)}
      onActivate={(tweet) => {
        setSelectedTweetId(tweet.id);
        setDetailOpen(true);
      }}
      renderCell={renderCell}
      emptyContent={emptyContent}
      emptyStateTitle={loading ? "Loading tweets..." : error ?? emptyStateTitle ?? "No tweets"}
      emptyStateHint={emptyStateHint ?? data?.query}
    />
  );
}

export function TwitterTickerTab({ focused, width, height }: DetailTabProps) {
  const { symbol } = usePaneTicker();
  const load = useCallback(() => {
    if (!symbol) throw new Error("No ticker selected");
    return apiClient.getCloudTickerTweets({
      ticker: symbol,
      hours: DEFAULT_TWEET_HOURS,
      limit: DEFAULT_TWEET_LIMIT,
      includeReplies: false,
    });
  }, [symbol]);

  if (!symbol) {
    return <EmptyState title="No ticker selected." />;
  }

  return (
    <TweetSearchTable
      focused={focused}
      width={width}
      height={height}
      requestKey={`ticker:${symbol}`}
      footerId="ticker-tweets"
      load={load}
    />
  );
}

function TwitterFeedSearchBar({
  feed,
  focused,
  active,
  width,
  focusToken,
  inputRef,
  onFocus,
  onBlur,
  onQueryChange,
}: {
  feed: TwitterFeed;
  focused: boolean;
  active: boolean;
  width: number;
  focusToken: number;
  inputRef: RefObject<InputRenderable | null>;
  onFocus: () => void;
  onBlur: () => void;
  onQueryChange: (feedId: string, query: string) => void;
}) {
  const [draft, setDraft] = useState(feed.query);

  useEffect(() => {
    setDraft(feed.query);
  }, [feed.id, feed.query]);

  useEffect(() => {
    if (focused && active) inputRef.current?.focus?.();
  }, [active, feed.id, focused, focusToken, inputRef]);

  useEffect(() => {
    if (draft === feed.query) return;
    const timer = setTimeout(() => {
      onQueryChange(feed.id, draft);
    }, TWEET_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, feed.id, feed.query, onQueryChange]);

  const commitNow = useCallback((value: string) => {
    onQueryChange(feed.id, value);
    onBlur();
  }, [feed.id, onBlur, onQueryChange]);

  return (
    <Box
      height={1}
      width={width}
      flexDirection="row"
      backgroundColor={colors.panel}
      onMouseDown={(event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onFocus();
        inputRef.current?.focus?.();
      }}
    >
      <Text fg={active ? colors.textBright : colors.textDim}>/</Text>
      <Box width={1} />
      <Input
        ref={inputRef}
        value={draft}
        focused={focused && active}
        placeholder="$AAPL -filter:replies"
        placeholderColor={colors.textDim}
        textColor={colors.text}
        focusedTextColor={colors.text}
        backgroundColor={colors.panel}
        focusedBackgroundColor={colors.panel}
        cursorColor={colors.textBright}
        flexGrow={1}
        onFocus={onFocus}
        onInput={setDraft}
        onChange={setDraft}
        onSubmit={commitNow}
      />
    </Box>
  );
}

export function TwitterFeedPane({ focused, width, height }: PaneProps) {
  const paneId = usePaneInstanceId();
  const paneInstance = usePaneInstance();
  const [persistedState, setPersistedState] = usePluginState<PersistedTwitterFeedState>(
    `twitter-feed:${paneId}`,
    EMPTY_FEED_STATE,
    { schemaVersion: TWEET_SEARCH_SCHEMA_VERSION },
  );
  const [launchRequest, setLaunchRequest] = usePluginState<TwitterFeedLaunchRequest | null>(
    TWITTER_FEED_LAUNCH_STATE_KEY,
    null,
    { schemaVersion: TWITTER_FEED_LAUNCH_SCHEMA_VERSION },
  );
  const [activeFeedId, setActiveFeedId] = usePluginPaneState<string | null>("activeFeedId", null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const initializedRef = useRef(false);
  const feeds = useMemo(() => normalizeFeeds(persistedState), [persistedState]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);

  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const updateFeeds = useCallback((updater: (feeds: TwitterFeed[]) => TwitterFeed[]) => {
    setPersistedState((current) => ({ feeds: updater(normalizeFeeds(current)) }));
  }, [setPersistedState]);

  const addFeed = useCallback((query = "", queryType: CloudTweetQueryType = "Latest") => {
    const feed = createFeed(query, queryType);
    updateFeeds((current) => [...current, feed]);
    setActiveFeedId(feed.id);
    focusSearch();
    return feed.id;
  }, [focusSearch, setActiveFeedId, updateFeeds]);

  const openOrCreateFeed = useCallback((
    query: string,
    queryType: CloudTweetQueryType = "Latest",
    options?: { focusSearch?: boolean },
  ) => {
    const normalizedQuery = normalizeFeedQuery(query);
    if (!normalizedQuery) {
      if (feeds.length === 0) addFeed("", queryType);
      return;
    }

    let nextActiveId: string | null = null;
    updateFeeds((current) => {
      const existing = current.find((feed) => normalizeFeedQuery(feed.query) === normalizedQuery);
      if (existing) {
        nextActiveId = existing.id;
        return current;
      }
      const feed = createFeed(query, queryType);
      nextActiveId = feed.id;
      return [...current, feed];
    });
    if (nextActiveId) setActiveFeedId(nextActiveId);
    if (options?.focusSearch) focusSearch();
  }, [addFeed, feeds.length, focusSearch, setActiveFeedId, updateFeeds]);

  const updateFeedQuery = useCallback((feedId: string, query: string) => {
    const now = Date.now();
    updateFeeds((current) => current.map((feed) => (
      feed.id === feedId
        ? {
          ...feed,
          query,
          title: deriveFeedTitle(query),
          updatedAt: now,
          lastError: null,
        }
        : feed
    )));
  }, [updateFeeds]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (feeds.length > 0) return;
    const seedQuery = typeof paneInstance?.params?.query === "string" ? paneInstance.params.query : "";
    const seedType = paneInstance?.params?.queryType === "Top" ? "Top" : "Latest";
    const feed = createFeed(seedQuery, seedType);
    setPersistedState({ feeds: [feed] });
    setActiveFeedId(feed.id);
    if (!seedQuery.trim()) focusSearch();
  }, [feeds.length, focusSearch, paneInstance?.params?.query, paneInstance?.params?.queryType, setActiveFeedId, setPersistedState]);

  useEffect(() => {
    if (!launchRequest) return;
    if (launchRequest.targetPaneId && launchRequest.targetPaneId !== paneId) return;

    const queryType = launchRequest.queryType === "Top" ? "Top" : "Latest";
    if (launchRequest.query.trim()) {
      openOrCreateFeed(launchRequest.query, queryType);
    } else if (feeds.length === 0) {
      addFeed("", queryType);
    }
    setLaunchRequest(null);
  }, [addFeed, feeds.length, launchRequest, openOrCreateFeed, paneId, setLaunchRequest]);

  useEffect(() => {
    if (feeds.length === 0) {
      if (activeFeedId !== null) setActiveFeedId(null);
      return;
    }
    if (!activeFeedId || !feeds.some((feed) => feed.id === activeFeedId)) {
      setActiveFeedId(feeds[0]!.id);
    }
  }, [activeFeedId, feeds, setActiveFeedId]);

  const activeFeed = feeds.find((feed) => feed.id === activeFeedId) ?? feeds[0] ?? null;

  const removeFeed = useCallback((feedId: string) => {
    let nextActiveId: string | null = null;
    let createdEmpty = false;
    updateFeeds((current) => {
      const next = current.filter((feed) => feed.id !== feedId);
      if (next.length === 0) {
        const feed = createFeed("", "Latest");
        nextActiveId = feed.id;
        createdEmpty = true;
        return [feed];
      }
      nextActiveId = activeFeedId === feedId
        ? next[0]!.id
        : activeFeedId && next.some((feed) => feed.id === activeFeedId)
          ? activeFeedId
          : next[0]!.id;
      return next;
    });
    if (nextActiveId) setActiveFeedId(nextActiveId);
    if (createdEmpty) focusSearch();
  }, [activeFeedId, focusSearch, setActiveFeedId, updateFeeds]);

  const cycleFeeds = useCallback((direction: -1 | 1) => {
    if (!activeFeed || feeds.length <= 1) return;
    const index = feeds.findIndex((feed) => feed.id === activeFeed.id);
    const nextIndex = (index + direction + feeds.length) % feeds.length;
    setActiveFeedId(feeds[nextIndex]!.id);
  }, [activeFeed, feeds, setActiveFeedId]);

  useShortcut((event) => {
    if (!focused) return;

    if (searchFocused) {
      if (event.name === "escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        blurSearch();
      }
      return;
    }

    if (event.name === "n") {
      event.preventDefault?.();
      event.stopPropagation?.();
      addFeed();
      return;
    }
    if (event.name === "/" || event.sequence === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return;
    }
    if (event.name === "d" && activeFeed) {
      event.preventDefault?.();
      event.stopPropagation?.();
      removeFeed(activeFeed.id);
      return;
    }
    if (event.name === "[") {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleFeeds(-1);
      return;
    }
    if (event.name === "]") {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleFeeds(1);
    }
  }, { allowEditable: true });

  const activeFeedIdValue = activeFeed?.id ?? null;
  const activeFeedQuery = activeFeed?.query.trim() ?? "";
  const activeFeedQueryType = activeFeed?.queryType ?? "Latest";
  const searchEnabled = activeFeedQuery.length > 0;
  const loadActiveFeed = useCallback(() => {
    if (!activeFeedQuery) throw new Error("No X feed selected");
    return apiClient.searchCloudTweets({
      query: activeFeedQuery,
      queryType: activeFeedQueryType,
      hours: DEFAULT_TWEET_HOURS,
      limit: DEFAULT_TWEET_LIMIT,
    });
  }, [activeFeedQuery, activeFeedQueryType]);

  const markFeedResult = useCallback((result: CloudTweetSearchResponse) => {
    if (!activeFeedIdValue) return;
    const now = Date.now();
    updateFeeds((current) => current.map((feed) => (
      feed.id === activeFeedIdValue
        ? { ...feed, lastSuccessAt: now, lastError: null, title: deriveFeedTitle(result.query) }
        : feed
    )));
  }, [activeFeedIdValue, updateFeeds]);

  const markFeedError = useCallback((message: string) => {
    if (!activeFeedIdValue) return;
    updateFeeds((current) => current.map((feed) => (
      feed.id === activeFeedIdValue ? { ...feed, lastError: message } : feed
    )));
  }, [activeFeedIdValue, updateFeeds]);

  usePaneFooter(TWITTER_FEED_PANE_ID, () => ({
    info: activeFeed
      ? [
        { id: "mode", parts: [{ text: activeFeed.queryType, tone: "value" }] },
        ...(activeFeed.lastSuccessAt ? [{ id: "last", parts: [{ text: `ran ${formatTimeAgo(new Date(activeFeed.lastSuccessAt))}`, tone: "muted" as const }] }] : []),
      ]
      : [],
    hints: searchFocused
      ? [
        { id: "done", key: "Esc", label: "done", onPress: blurSearch },
      ]
      : [
        { id: "new", key: "n", label: "ew", onPress: () => addFeed() },
        { id: "search", key: "/", label: "search", onPress: focusSearch, disabled: !activeFeed },
        { id: "delete", key: "d", label: "elete", onPress: activeFeed ? () => removeFeed(activeFeed.id) : undefined, disabled: !activeFeed },
      ],
  }), [activeFeed, addFeed, blurSearch, focusSearch, removeFeed, searchFocused]);

  const searchBar = activeFeed ? (
    <TwitterFeedSearchBar
      feed={activeFeed}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onQueryChange={updateFeedQuery}
    />
  ) : null;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <Tabs
          tabs={feeds.map((feed) => ({
            label: truncateWithEllipsis(feed.title, 18),
            value: feed.id,
            onClose: removeFeed,
            onDoubleClick: focusSearch,
          }))}
          activeValue={activeFeed?.id ?? null}
          onSelect={(id) => {
            setActiveFeedId(id);
          }}
          compact
          variant="pill"
          closeMode="active"
          onAdd={() => addFeed()}
          focused={focused && !searchFocused}
        />
      </Box>

      {!activeFeed ? (
        <Box padding={1} flexGrow={1}>
          <EmptyState title="No X feeds yet." />
        </Box>
      ) : (
        <TweetSearchTable
          focused={focused && !searchFocused}
          width={width}
          height={Math.max(1, height - 1)}
          requestKey={`feed:${activeFeed.id}:${activeFeed.query}:${activeFeed.queryType}`}
          footerId="twitter-feed-search"
          rootBefore={searchBar}
          enabled={searchEnabled}
          load={loadActiveFeed}
          onResult={markFeedResult}
          onError={markFeedError}
          emptyStateTitle={searchEnabled ? "No tweets" : "Enter a search query"}
          emptyStateHint={searchEnabled ? activeFeedQuery : undefined}
        />
      )}
    </Box>
  );
}
