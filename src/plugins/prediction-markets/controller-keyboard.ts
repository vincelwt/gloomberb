import { useCallback, type RefObject } from "react";
import { type ScrollBoxRenderable } from "../../ui";
import { useShortcut } from "../../react/input";
import { getAdjacentPredictionCategoryId } from "./categories";
import { resolvePredictionKeyboardCommand } from "./keyboard";
import { getAdjacentPredictionVenueScope } from "./navigation";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionDetailTab,
  PredictionListRow,
  PredictionMarketSummary,
  PredictionVenueScope,
} from "./types";

interface PredictionKeyboardEvent {
  name?: string;
  sequence?: string;
  shift?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

interface UsePredictionControllerKeyboardParams {
  categoryId: PredictionCategoryId;
  detailOpen: boolean;
  detailScrollRef: RefObject<ScrollBoxRenderable | null>;
  detailTab: PredictionDetailTab;
  effectiveVenueScope: PredictionVenueScope;
  focused: boolean;
  hideTabs: boolean;
  searchFocused: boolean;
  selectedRow: PredictionListRow | null;
  selectedSummaryKey: string | null;
  sortedOutcomeMarkets: PredictionMarketSummary[];
  blurSearch: () => void;
  focusSearch: () => void;
  selectBrowseTab: (tab: PredictionBrowseTab) => void;
  selectCategory: (categoryId: PredictionCategoryId) => void;
  selectMarket: (marketKey: string) => void;
  setVenue: (venueScope: PredictionVenueScope) => void;
  toggleWatchlist: (row: PredictionListRow) => void;
}

export function usePredictionControllerKeyboard({
  categoryId,
  detailOpen,
  detailScrollRef,
  detailTab,
  effectiveVenueScope,
  focused,
  hideTabs,
  searchFocused,
  selectedRow,
  selectedSummaryKey,
  sortedOutcomeMarkets,
  blurSearch,
  focusSearch,
  selectBrowseTab,
  selectCategory,
  selectMarket,
  setVenue,
  toggleWatchlist,
}: UsePredictionControllerKeyboardParams) {
  const cycleDetailOutcome = useCallback(
    (direction: "previous" | "next") => {
      if (detailTab !== "overview" || sortedOutcomeMarkets.length === 0) {
        return;
      }
      const currentIndex = sortedOutcomeMarkets.findIndex(
        (market) => market.key === selectedSummaryKey,
      );
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        direction === "previous"
          ? Math.max(safeIndex - 1, 0)
          : Math.min(safeIndex + 1, sortedOutcomeMarkets.length - 1);
      const nextMarket = sortedOutcomeMarkets[nextIndex];
      if (nextMarket) {
        selectMarket(nextMarket.key);
      }
    },
    [detailTab, selectMarket, selectedSummaryKey, sortedOutcomeMarkets],
  );

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox) return;
    const maxScrollTop = Math.max(
      0,
      scrollBox.scrollHeight - scrollBox.viewport.height,
    );
    scrollBox.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollBox.scrollTop + delta),
    );
  }, [detailScrollRef]);

  const handleKeyboard = useCallback(
    (event: PredictionKeyboardEvent) => {
      if (!focused) return;
      const command = resolvePredictionKeyboardCommand(event);

      if (searchFocused) {
        if (command === "escape") {
          event.stopPropagation?.();
          event.preventDefault?.();
          blurSearch();
        }
        return;
      }

      if (detailOpen) {
        if (command === "move-down") {
          event.stopPropagation?.();
          event.preventDefault?.();
          if (detailTab === "overview" && sortedOutcomeMarkets.length > 0) {
            cycleDetailOutcome("next");
          } else {
            scrollDetailBy(1);
          }
          return;
        }

        if (command === "move-up") {
          event.stopPropagation?.();
          event.preventDefault?.();
          if (detailTab === "overview" && sortedOutcomeMarkets.length > 0) {
            cycleDetailOutcome("previous");
          } else {
            scrollDetailBy(-1);
          }
        }

        return;
      }

      if (command === "search") {
        event.stopPropagation?.();
        event.preventDefault?.();
        focusSearch();
        return;
      }

      if (!hideTabs && command === "previous-venue-tab") {
        event.stopPropagation?.();
        event.preventDefault?.();
        setVenue(
          getAdjacentPredictionVenueScope(effectiveVenueScope, "previous"),
        );
        return;
      }

      if (!hideTabs && command === "next-venue-tab") {
        event.stopPropagation?.();
        event.preventDefault?.();
        setVenue(getAdjacentPredictionVenueScope(effectiveVenueScope, "next"));
        return;
      }

      if (command === "previous-category") {
        event.stopPropagation?.();
        event.preventDefault?.();
        selectCategory(getAdjacentPredictionCategoryId(categoryId, "previous"));
        return;
      }

      if (command === "next-category") {
        event.stopPropagation?.();
        event.preventDefault?.();
        selectCategory(getAdjacentPredictionCategoryId(categoryId, "next"));
        return;
      }

      if (command === "toggle-watchlist" && selectedRow) {
        event.stopPropagation?.();
        event.preventDefault?.();
        toggleWatchlist(selectedRow);
        return;
      }

      if (command === "browse-top") {
        selectBrowseTab("top");
        return;
      }
      if (command === "browse-ending") {
        selectBrowseTab("ending");
        return;
      }
      if (command === "browse-new") {
        selectBrowseTab("new");
        return;
      }
      if (command === "browse-watchlist") {
        selectBrowseTab("watchlist");
      }
    },
    [
      blurSearch,
      categoryId,
      cycleDetailOutcome,
      detailOpen,
      detailTab,
      effectiveVenueScope,
      focusSearch,
      focused,
      hideTabs,
      scrollDetailBy,
      searchFocused,
      selectBrowseTab,
      selectCategory,
      selectedRow,
      setVenue,
      sortedOutcomeMarkets.length,
      toggleWatchlist,
    ],
  );

  useShortcut(handleKeyboard);
}
