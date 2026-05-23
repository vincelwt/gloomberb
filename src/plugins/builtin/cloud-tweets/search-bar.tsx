import { useCallback, useEffect, useState, type RefObject } from "react";
import { Box, Input, Text, type InputRenderable } from "../../../ui";
import { colors } from "../../../theme/colors";
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
      onMouseDown={(event: any) => {
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
