import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Box, ScrollBox, Text, TextAttributes, Textarea, type TextareaRenderable } from "../../ui";
import { useShortcut } from "../../react/input";
import {
  Button,
  DataTableStackView,
  EmptyState,
  SegmentedControl,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../components";
import type { DetailTabProps, PaneProps } from "../../types/plugin";
import { usePaneInstance, usePaneInstanceId, usePaneTicker } from "../../state/app-context";
import { usePluginPaneState, usePluginState } from "../plugin-runtime";
import { TickerBadgeText } from "../../components/ticker-badge-text";
import { ExternalLinkText, openUrl } from "../../components/ui";
import { useInlineTickers } from "../../state/use-inline-tickers";
import { apiClient, type CloudTweetPayload, type CloudTweetQueryType, type CloudTweetSearchResponse } from "../../utils/api-client";
import { collectUniqueTickerSymbols } from "../../utils/ticker-tokenizer";
import { formatCompact, formatTimeAgo } from "../../utils/format";
import { colors } from "../../theme/colors";
import { CloudAuthNotice } from "./cloud-auth-actions";

const DEFAULT_TWEET_HOURS = 6;
const DEFAULT_TWEET_LIMIT = 50;
const TWEET_SEARCH_SCHEMA_VERSION = 1;

type TweetColumnId = "time" | "author" | "text" | "tickers" | "likes" | "views";
type TweetColumn = DataTableColumn & { id: TweetColumnId };

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

interface FeedEditorState {
  mode: "create" | "edit";
  feedId: string | null;
  query: string;
  queryType: CloudTweetQueryType;
  key: string;
  error: string | null;
}

const EMPTY_FEED_STATE: PersistedTwitterFeedState = { feeds: [] };
let nextTwitterFeedId = 1;
let nextTwitterEditorId = 1;

function generateFeedId(): string {
  return `${Date.now()}-${nextTwitterFeedId++}`;
}

function generateEditorKey(): string {
  return `twitter-editor-${Date.now()}-${nextTwitterEditorId++}`;
}

function truncateWithEllipsis(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function deriveFeedTitle(query: string): string {
  const tickers = collectUniqueTickerSymbols([query]);
  if (tickers.length > 0) return tickers.slice(0, 3).map((ticker) => `$${ticker}`).join(" ");
  return truncateWithEllipsis(query.replace(/\s+/g, " ").trim(), 24) || "X Feed";
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

function tweetTickers(tweet: CloudTweetPayload): string[] {
  return collectUniqueTickerSymbols([tweet.text]);
}

function buildTweetColumns(width: number): TweetColumn[] {
  const timeWidth = 7;
  const authorWidth = 16;
  const tickersWidth = 14;
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

function TweetSearchHeader({
  data,
  loading,
  width,
}: {
  data: CloudTweetSearchResponse | null;
  loading: boolean;
  width: number;
}) {
  if (!data && !loading) return null;
  const text = data
    ? `${data.queryType} ${data.query}${data.cached ? " cached" : ""} - ${formatRelativeShort(data.asOf)}`
    : "Loading tweets...";
  return (
    <Box height={1} paddingX={1} width={width}>
      <Text fg={loading ? colors.textDim : colors.textMuted}>
        {truncateWithEllipsis(text, Math.max(1, width - 2))}
      </Text>
    </Box>
  );
}

function TweetDetail({
  tweet,
  width,
}: {
  tweet: CloudTweetPayload;
  width: number;
}) {
  const lineWidth = Math.max(1, width - 2);
  const { catalog, openTicker } = useInlineTickers([tweet.text]);
  const author = tweet.author.userName ? `@${tweet.author.userName}` : tweet.author.name;

  return (
    <ScrollBox scrollY focusable={false} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth} gap={1}>
        <Box flexDirection="row" height={1}>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{author}</Text>
          <Text fg={colors.textDim}> - {formatTimeAgo(tweet.createdAt)}</Text>
        </Box>
        <TickerBadgeText
          text={tweet.text}
          lineWidth={lineWidth}
          catalog={catalog}
          textColor={colors.text}
          openTicker={openTicker}
        />
        <Box flexDirection="row" height={1}>
          <Text fg={colors.textDim}>
            {`likes ${formatMetric(tweet.metrics.likes)}  reposts ${formatMetric(tweet.metrics.retweets)}  replies ${formatMetric(tweet.metrics.replies)}  views ${formatMetric(tweet.metrics.views)}`}
          </Text>
        </Box>
        {tweet.url ? (
          <Box height={1}>
            <ExternalLinkText url={tweet.url} label="Open on X" color={colors.textBright} />
          </Box>
        ) : null}
      </Box>
    </ScrollBox>
  );
}

function useTweetSearchData(
  requestKey: string,
  load: () => Promise<CloudTweetSearchResponse>,
  onResult?: (result: CloudTweetSearchResponse) => void,
  onError?: (message: string) => void,
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
  }, [load]);

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
  load,
  onResult,
  onError,
}: {
  focused: boolean;
  width: number;
  height: number;
  requestKey: string;
  footerId: string;
  load: () => Promise<CloudTweetSearchResponse>;
  onResult?: (result: CloudTweetSearchResponse) => void;
  onError?: (message: string) => void;
}) {
  const { data, loading, error, reload } = useTweetSearchData(requestKey, load, onResult, onError);
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const rows = useMemo(() => (
    [...(data?.tweets ?? [])].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  ), [data?.tweets]);
  const columns = useMemo(() => buildTweetColumns(width), [width]);
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
    if (selectedTweet?.url) openUrl(selectedTweet.url);
  }, [selectedTweet]);

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
      ...(data ? [{ id: "count", parts: [{ text: `${rows.length} tweets`, tone: "value" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: reload },
      ...(detailOpen ? [{ id: "open", key: "o", label: "open tweet", onPress: openSelectedTweet, disabled: !selectedTweet?.url }] : []),
    ],
  }), [data, detailOpen, error, footerId, loading, openSelectedTweet, reload, rows.length, selectedTweet?.url]);

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
        return { text: tweet.text.replace(/\s+/g, " "), color: selectedColor ?? colors.text };
      case "tickers":
        return { text: tweetTickers(tweet).map((ticker) => `$${ticker}`).join(" "), color: selectedColor ?? colors.positive };
      case "likes":
        return { text: formatMetric(tweet.metrics.likes), color: selectedColor ?? colors.textDim };
      case "views":
        return { text: formatMetric(tweet.metrics.views), color: selectedColor ?? colors.textDim };
    }
  }, []);

  const emptyContent = error && isAuthError(error)
    ? <CloudAuthNotice message={error} showSignup />
    : undefined;

  return (
    <DataTableStackView<CloudTweetPayload, TweetColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={() => setDetailOpen(false)}
      detailTitle={selectedTweet ? `@${selectedTweet.author.userName || selectedTweet.author.name}` : "Tweet"}
      detailContent={selectedTweet ? <TweetDetail tweet={selectedTweet} width={width} /> : null}
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
      rootWidth={width}
      rootHeight={height}
      rootBefore={<TweetSearchHeader data={data} loading={loading} width={width} />}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(tweet) => tweet.id}
      isSelected={(tweet) => tweet.id === selectedTweetId}
      onSelect={(tweet) => setSelectedTweetId(tweet.id)}
      onActivate={(tweet) => {
        setSelectedTweetId(tweet.id);
        setDetailOpen(true);
      }}
      renderCell={renderCell}
      emptyContent={emptyContent}
      emptyStateTitle={loading ? "Loading tweets..." : error ?? "No tweets"}
      emptyStateHint={data?.query}
      showHorizontalScrollbar={false}
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

function TwitterFeedEditor({
  editor,
  focused,
  width,
  textareaRef,
  onChange,
}: {
  editor: FeedEditorState;
  focused: boolean;
  width: number;
  textareaRef: RefObject<TextareaRenderable | null>;
  onChange: (patch: Partial<FeedEditorState>) => void;
}) {
  useEffect(() => {
    if (focused) textareaRef.current?.focus?.();
  }, [editor.key, focused, textareaRef]);

  return (
    <Box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <Box height={1} flexDirection="row" gap={1}>
        <Text fg={colors.textDim}>Mode</Text>
        <SegmentedControl
          value={editor.queryType}
          options={[
            { label: "Latest", value: "Latest" },
            { label: "Top", value: "Top" },
          ]}
          onChange={(value) => onChange({ queryType: value === "Top" ? "Top" : "Latest" })}
        />
      </Box>
      <Box flexGrow={1} minHeight={5} border borderColor={colors.border} backgroundColor={colors.panel}>
        <Textarea
          key={editor.key}
          ref={textareaRef}
          initialValue={editor.query}
          placeholder="$AAPL -filter:replies"
          focused={focused}
          textColor={colors.text}
          placeholderColor={colors.textDim}
          backgroundColor={colors.panel}
          flexGrow={1}
          wrapText
        />
      </Box>
      {editor.error ? (
        <Text fg={colors.negative}>{editor.error}</Text>
      ) : (
        <Text fg={colors.textDim}>{truncateWithEllipsis("Use X advanced search syntax. Example: $AAPL OR $MSFT -filter:replies", Math.max(1, width - 2))}</Text>
      )}
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
  const [activeFeedId, setActiveFeedId] = usePluginPaneState<string | null>("activeFeedId", null);
  const [editorState, setEditorState] = useState<FeedEditorState | null>(null);
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const initializedRef = useRef(false);
  const feeds = useMemo(() => normalizeFeeds(persistedState), [persistedState]);

  const updateFeeds = useCallback((updater: (feeds: TwitterFeed[]) => TwitterFeed[]) => {
    setPersistedState((current) => ({ feeds: updater(normalizeFeeds(current)) }));
  }, [setPersistedState]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (feeds.length > 0) return;
    const seedQuery = typeof paneInstance?.params?.query === "string" ? paneInstance.params.query.trim() : "";
    if (!seedQuery) return;
    const seedType = paneInstance?.params?.queryType === "Top" ? "Top" : "Latest";
    const feed = createFeed(seedQuery, seedType);
    setPersistedState({ feeds: [feed] });
    setActiveFeedId(feed.id);
  }, [feeds.length, paneInstance?.params?.query, paneInstance?.params?.queryType, setActiveFeedId, setPersistedState]);

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

  const openCreateEditor = useCallback(() => {
    setEditorState({
      mode: "create",
      feedId: null,
      query: "",
      queryType: "Latest",
      key: generateEditorKey(),
      error: null,
    });
  }, []);

  const openEditEditor = useCallback((feed: TwitterFeed | null) => {
    if (!feed) return;
    setEditorState({
      mode: "edit",
      feedId: feed.id,
      query: feed.query,
      queryType: feed.queryType,
      key: generateEditorKey(),
      error: null,
    });
  }, []);

  const closeEditor = useCallback(() => {
    textareaRef.current = null;
    setEditorState(null);
  }, []);

  const saveEditor = useCallback(() => {
    if (!editorState) return;
    const query = textareaRef.current?.editBuffer.getText().trim() || editorState.query.trim();
    if (!query) {
      setEditorState((current) => current ? { ...current, error: "Query is required." } : current);
      return;
    }

    if (editorState.mode === "create") {
      const feed = createFeed(query, editorState.queryType);
      updateFeeds((current) => [...current, feed]);
      setActiveFeedId(feed.id);
    } else if (editorState.feedId) {
      const now = Date.now();
      updateFeeds((current) => current.map((feed) => (
        feed.id === editorState.feedId
          ? {
            ...feed,
            query,
            queryType: editorState.queryType,
            title: deriveFeedTitle(query),
            updatedAt: now,
            lastError: null,
          }
          : feed
      )));
    }

    closeEditor();
  }, [closeEditor, editorState, setActiveFeedId, updateFeeds]);

  const removeFeed = useCallback((feedId: string) => {
    updateFeeds((current) => current.filter((feed) => feed.id !== feedId));
    if (activeFeedId === feedId) {
      const next = feeds.filter((feed) => feed.id !== feedId)[0] ?? null;
      setActiveFeedId(next?.id ?? null);
    }
  }, [activeFeedId, feeds, setActiveFeedId, updateFeeds]);

  const cycleFeeds = useCallback((direction: -1 | 1) => {
    if (!activeFeed || feeds.length <= 1) return;
    const index = feeds.findIndex((feed) => feed.id === activeFeed.id);
    const nextIndex = (index + direction + feeds.length) % feeds.length;
    setActiveFeedId(feeds[nextIndex]!.id);
  }, [activeFeed, feeds, setActiveFeedId]);

  useShortcut((event) => {
    if (!focused) return;

    if (editorState) {
      if (event.name === "escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        closeEditor();
      }
      if (event.ctrl && event.name === "s") {
        event.preventDefault?.();
        event.stopPropagation?.();
        saveEditor();
      }
      return;
    }

    if (event.name === "t" || event.name === "n") {
      event.preventDefault?.();
      event.stopPropagation?.();
      openCreateEditor();
      return;
    }
    if (event.name === "e") {
      event.preventDefault?.();
      event.stopPropagation?.();
      openEditEditor(activeFeed);
      return;
    }
    if (event.name === "w" && activeFeed) {
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
  });

  const activeFeedIdValue = activeFeed?.id ?? null;
  const activeFeedQuery = activeFeed?.query ?? null;
  const activeFeedQueryType = activeFeed?.queryType ?? "Latest";
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

  usePaneFooter("twitter-feed", () => ({
    info: activeFeed
      ? [
        { id: "mode", parts: [{ text: activeFeed.queryType, tone: "value" }] },
        ...(activeFeed.lastSuccessAt ? [{ id: "last", parts: [{ text: `ran ${formatTimeAgo(new Date(activeFeed.lastSuccessAt))}`, tone: "muted" as const }] }] : []),
      ]
      : [],
    hints: editorState
      ? [{ id: "save", key: "Ctrl+S", label: "save", onPress: saveEditor }]
      : [
        { id: "new", key: "t", label: "new", onPress: openCreateEditor },
        { id: "edit", key: "e", label: "edit", onPress: () => openEditEditor(activeFeed), disabled: !activeFeed },
        { id: "delete", key: "w", label: "delete", onPress: activeFeed ? () => removeFeed(activeFeed.id) : undefined, disabled: !activeFeed },
      ],
  }), [activeFeed, editorState, openCreateEditor, openEditEditor, removeFeed, saveEditor]);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <Tabs
          tabs={feeds.map((feed) => ({
            label: truncateWithEllipsis(feed.title, 18),
            value: feed.id,
            onClose: editorState ? undefined : removeFeed,
            onDoubleClick: (id) => openEditEditor(feeds.find((feed) => feed.id === id) ?? null),
          }))}
          activeValue={activeFeed?.id ?? null}
          onSelect={(id) => {
            if (editorState) return;
            setActiveFeedId(id);
          }}
          compact
          variant="pill"
          closeMode="active"
          onAdd={editorState ? undefined : openCreateEditor}
        />
      </Box>

      <Box height={1} flexDirection="row" gap={1}>
        {editorState ? (
          <>
            <Button label="Save" variant="primary" onPress={saveEditor} />
            <Button label="Cancel" variant="ghost" onPress={closeEditor} />
          </>
        ) : (
          <>
            <Button label="New Feed" variant="primary" onPress={openCreateEditor} />
            <Button label="Edit" variant="secondary" onPress={() => openEditEditor(activeFeed)} disabled={!activeFeed} />
            <Button label="Delete" variant="ghost" onPress={() => activeFeed && removeFeed(activeFeed.id)} disabled={!activeFeed} />
          </>
        )}
      </Box>

      {editorState ? (
        <TwitterFeedEditor
          editor={editorState}
          focused={focused}
          width={width}
          textareaRef={textareaRef}
          onChange={(patch) => setEditorState((current) => current ? { ...current, ...patch, error: null } : current)}
        />
      ) : !activeFeed ? (
        <Box padding={1} flexGrow={1}>
          <EmptyState title="No X feeds yet." hint="Use + or TWIT <query>." />
        </Box>
      ) : (
        <TweetSearchTable
          focused={focused}
          width={width}
          height={Math.max(1, height - 2)}
          requestKey={`feed:${activeFeed.id}:${activeFeed.query}:${activeFeed.queryType}`}
          footerId="twitter-feed-search"
          load={loadActiveFeed}
          onResult={markFeedResult}
          onError={markFeedError}
        />
      )}
    </Box>
  );
}
