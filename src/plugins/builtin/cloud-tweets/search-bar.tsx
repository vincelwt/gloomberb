import { useCallback, type RefObject } from "react";
import type { InputRenderable } from "../../../ui";
import { InputSearchBar } from "../../../components";
import {
  TWEET_SEARCH_DEBOUNCE_MS,
  type TwitterFeed,
} from "./model";

export function TwitterFeedSearchBar({
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
  const updateQuery = useCallback((value: string) => {
    onQueryChange(feed.id, value);
  }, [feed.id, onQueryChange]);

  return (
    <InputSearchBar
      value={feed.query}
      focused={focused}
      active={active}
      width={width}
      focusToken={focusToken}
      inputRef={inputRef}
      placeholder="$AAPL -filter:replies"
      debounceMs={TWEET_SEARCH_DEBOUNCE_MS}
      onFocus={onFocus}
      onBlur={onBlur}
      onQueryChange={updateQuery}
    />
  );
}
