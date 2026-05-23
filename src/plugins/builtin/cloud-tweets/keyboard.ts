import { useShortcut } from "../../../react/input";
import type { TwitterFeed } from "./model";

export function useTwitterFeedKeyboard({
  activeFeed,
  addFeed,
  blurSearch,
  cycleFeeds,
  focusSearch,
  focused,
  removeFeed,
  searchFocused,
}: {
  activeFeed: TwitterFeed | null;
  addFeed: () => void;
  blurSearch: () => void;
  cycleFeeds: (direction: -1 | 1) => void;
  focusSearch: () => void;
  focused: boolean;
  removeFeed: (feedId: string) => void;
  searchFocused: boolean;
}) {
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
}
