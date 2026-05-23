import type { GloomPluginContext } from "../../../types/plugin";
import {
  TWITTER_FEED_LAUNCH_SCHEMA_VERSION,
  TWITTER_FEED_LAUNCH_STATE_KEY,
  TWITTER_FEED_PANE_ID,
  type TwitterFeedLaunchRequest,
} from "./model";
import {
  TwitterFeedPane,
  TwitterTickerTab,
} from "./pane";

export function registerTwitterFeedFeature(ctx: GloomPluginContext): void {
  ctx.registerDetailTab({
    id: "ticker-tweets",
    name: "Tweets",
    order: 38,
    component: TwitterTickerTab,
    isVisible: ({ ticker }) => !!ticker,
  });

  ctx.registerPane({
    id: TWITTER_FEED_PANE_ID,
    name: "X Feed",
    icon: "X",
    component: TwitterFeedPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 94, height: 28 },
  });

  ctx.registerPaneTemplate({
    id: "twitter-feed-pane",
    paneId: TWITTER_FEED_PANE_ID,
    label: "X Feed",
    description: "Open an X advanced-search feed.",
    keywords: ["twitter", "x", "tweet", "tweets", "feed", "social"],
    createInstance: (_context, options) => {
      const query = options?.values?.query?.trim() || options?.arg?.trim() || "";
      return {
        title: "X Feed",
        placement: "floating",
        params: {
          query,
          queryType: options?.values?.queryType === "Top" ? "Top" : "Latest",
        },
      };
    },
  });

  ctx.registerCommand({
    id: "twitter-feed-open",
    label: "X Feed",
    description: "Open an X advanced-search feed.",
    keywords: ["twitter", "x", "tweet", "tweets", "feed", "social", "twit"],
    category: "navigation",
    shortcut: "TWIT",
    shortcutArg: {
      placeholder: "query",
      kind: "text",
      parse: (arg) => ({ query: arg.trim() }),
    },
    execute: (values) => {
      openTwitterFeed(ctx, values?.query ?? values?.shortcut ?? "");
    },
  });
}

function openTwitterFeed(ctx: GloomPluginContext, query = "") {
  const targetPaneId = ctx.getConfig().layout.instances.find((instance) => (
    instance.paneId === TWITTER_FEED_PANE_ID
  ))?.instanceId ?? null;
  const now = Date.now();
  const launchRequest: TwitterFeedLaunchRequest = {
    query: query.trim(),
    targetPaneId,
    nonce: `${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
  };

  ctx.resume.setState(
    TWITTER_FEED_LAUNCH_STATE_KEY,
    launchRequest,
    { schemaVersion: TWITTER_FEED_LAUNCH_SCHEMA_VERSION },
  );
  ctx.focusPane(TWITTER_FEED_PANE_ID);
}
