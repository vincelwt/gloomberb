import { usePaneFooter } from "../../../components";
import { formatTimeAgo } from "../../../utils/format";
import {
  TWITTER_FEED_PANE_ID,
  type TwitterFeed,
} from "./model";

export function useTwitterFeedFooter({
  activeFeed,
  addFeed,
  blurSearch,
  focusSearch,
  removeFeed,
  searchFocused,
}: {
  activeFeed: TwitterFeed | null;
  addFeed: () => void;
  blurSearch: () => void;
  focusSearch: () => void;
  removeFeed: (feedId: string) => void;
  searchFocused: boolean;
}) {
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
}
