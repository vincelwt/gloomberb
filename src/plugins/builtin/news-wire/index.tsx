import type { GloomPluginContext } from "../../../types/plugin";
import { createRssDataSource } from "./rss-source";
import { TopPane } from "./top-pane";
import { FeedPane } from "./feed-pane";
import { IndustryPane } from "./industry-pane";
import { BreakingPane } from "./breaking-pane";
import {
  BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
  setupBreakingNewsNotifications,
} from "./breaking-notifications";
import { setDigestPersistence } from "./digest-store";
import {
  addUserNewsFeed,
  getEnabledNewsFeeds,
  loadNewsFeedSettings,
  saveNewsFeedSettings,
} from "./feed-config";

export function registerNewsWireFeatures(ctx: GloomPluginContext): () => void {
  setDigestPersistence(ctx.persistence);
  ctx.registerPane({ id: "news-top", name: "Top News", icon: "T", component: TopPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 90, height: 30 } });
  ctx.registerPane({ id: "news-feed", name: "News Feed", icon: "N", component: FeedPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 35 } });
  ctx.registerPane({ id: "news-industry", name: "Sector News", icon: "S", component: IndustryPane, defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 100, height: 35 } });
  ctx.registerPane({
    id: "news-breaking",
    name: "Breaking News",
    icon: "!",
    component: BreakingPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 85, height: 20 },
    settings: {
      title: "Breaking News Settings",
      fields: [{
        key: BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY,
        label: "Notifications",
        description: "Notify when new breaking stories arrive, even while this pane is closed.",
        type: "toggle",
        storage: "plugin",
      }],
    },
  });

  ctx.registerPaneTemplate({ id: "news-top-pane", paneId: "news-top", label: "Top News", description: "Curated top market stories ranked by importance", keywords: ["top", "news", "headlines", "stories"], shortcut: { prefix: "TOP" } });
  ctx.registerPaneTemplate({ id: "news-feed-pane", paneId: "news-feed", label: "News Feed", description: "Chronological market news firehose", keywords: ["news", "feed", "firehose", "wire", "stream"], shortcut: { prefix: "N" } });
  ctx.registerPaneTemplate({ id: "news-industry-pane", paneId: "news-industry", label: "Sector News", description: "Market news filtered by sector", keywords: ["news", "industry", "sector", "ni", "filter"], shortcut: { prefix: "NI" } });
  ctx.registerPaneTemplate({ id: "news-breaking-pane", paneId: "news-breaking", label: "Breaking News", description: "Breaking and urgent market news", keywords: ["first", "breaking", "urgent", "alert", "flash"], shortcut: { prefix: "FIRST" } });

  const initialSettings = loadNewsFeedSettings(ctx.configState);
  if (initialSettings.migrated) {
    void saveNewsFeedSettings(ctx.configState, initialSettings);
  }

  const source = createRssDataSource(
    () => getEnabledNewsFeeds(loadNewsFeedSettings(ctx.configState)),
    { persistence: ctx.persistence },
  );
  ctx.registerDataSource(source);

  ctx.registerCommand({
    id: "add-news-feed",
    label: "Add News Feed",
    keywords: ["news", "rss", "feed", "add", "source"],
    category: "config",
    description: "Add a custom RSS news feed",
    wizardLayout: "form",
    wizard: [
      { key: "url", label: "Feed URL", type: "text", placeholder: "https://example.com/rss" },
      { key: "name", label: "Feed Name", type: "text", placeholder: "My Feed" },
      { key: "category", label: "Category", type: "select", options: [
        { label: "General", value: "general" },
        { label: "Tech", value: "tech" },
        { label: "Energy", value: "energy" },
        { label: "Finance", value: "finance" },
        { label: "Healthcare", value: "healthcare" },
        { label: "Macro", value: "macro" },
        { label: "Crypto", value: "crypto" },
      ]},
    ],
    async execute(values) {
      const url = values?.url?.trim();
      const name = values?.name?.trim();
      const category = values?.category ?? "general";
      if (!url || !name) return;

      const feed = await addUserNewsFeed(ctx.configState, { url, name, category });
      ctx.notify({ body: `Added news feed: ${feed.name}`, type: "success" });
    },
  });

  return setupBreakingNewsNotifications(ctx);
}
