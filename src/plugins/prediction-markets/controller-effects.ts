import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { type InputRenderable, type ScrollBoxRenderable } from "../../ui";
import {
  parsePredictionSearchShortcut,
  parsePredictionVenueScope,
} from "./navigation";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionListRow,
  PredictionVenueScope,
} from "./types";

type DebouncedSelectionSetter = (
  value: SetStateAction<string | null>,
  options?: { immediate?: boolean },
) => void;

interface UsePredictionControllerEffectsOptions {
  appViewportHeight: number;
  browseTab: PredictionBrowseTab;
  categoryId: PredictionCategoryId;
  debouncedSearchQuery: string;
  detailOpen: boolean;
  effectiveVenueScope: PredictionVenueScope;
  headerScrollRef: RefObject<ScrollBoxRenderable | null>;
  hideTabs: boolean;
  initialParams: Record<string, string> | undefined;
  initialParamsApplied: boolean;
  lastVenueScope: PredictionVenueScope;
  lockedVenueScope: PredictionVenueScope;
  previousFilterResetKeyRef: RefObject<string | null>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  searchFocused: boolean;
  searchInputRef: RefObject<InputRenderable | null>;
  selectedDetailMarketKey: string | null;
  selectedIndex: number;
  selectedRow: PredictionListRow | null;
  selectedRowKey: string | null;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  setInitialParamsApplied: Dispatch<SetStateAction<boolean>>;
  setLastVenueScope: Dispatch<SetStateAction<PredictionVenueScope>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedDetailMarketKey: DebouncedSelectionSetter;
  setSelectedRowKey: DebouncedSelectionSetter;
  setVenueScope: Dispatch<SetStateAction<PredictionVenueScope>>;
  visibleRowsLength: number;
}

export function usePredictionControllerEffects({
  appViewportHeight,
  browseTab,
  categoryId,
  debouncedSearchQuery,
  detailOpen,
  effectiveVenueScope,
  headerScrollRef,
  hideTabs,
  initialParams,
  initialParamsApplied,
  lastVenueScope,
  lockedVenueScope,
  previousFilterResetKeyRef,
  scrollRef,
  searchFocused,
  searchInputRef,
  selectedDetailMarketKey,
  selectedIndex,
  selectedRow,
  selectedRowKey,
  setDetailOpen,
  setInitialParamsApplied,
  setLastVenueScope,
  setSearchQuery,
  setSelectedDetailMarketKey,
  setSelectedRowKey,
  setVenueScope,
  visibleRowsLength,
}: UsePredictionControllerEffectsOptions): void {
  useEffect(() => {
    if (hideTabs && effectiveVenueScope !== lockedVenueScope) {
      setVenueScope(lockedVenueScope);
      return;
    }
    if (!hideTabs && effectiveVenueScope !== lastVenueScope) {
      setLastVenueScope(effectiveVenueScope);
    }
  }, [
    effectiveVenueScope,
    hideTabs,
    lastVenueScope,
    lockedVenueScope,
    setLastVenueScope,
    setVenueScope,
  ]);

  useEffect(() => {
    if (initialParamsApplied) return;
    const parsedScope = parsePredictionVenueScope(initialParams?.scope);
    const shortcut = parsePredictionSearchShortcut(initialParams?.query ?? "");
    if (parsedScope) {
      setVenueScope(parsedScope);
      setLastVenueScope(parsedScope);
    } else if (shortcut.searchQuery || shortcut.venueScope !== "all") {
      setVenueScope(shortcut.venueScope);
      setLastVenueScope(shortcut.venueScope);
    }
    if (shortcut.searchQuery) {
      setSearchQuery(shortcut.searchQuery);
    }
    setInitialParamsApplied(true);
  }, [
    initialParams?.query,
    initialParams?.scope,
    initialParamsApplied,
    setInitialParamsApplied,
    setLastVenueScope,
    setSearchQuery,
    setVenueScope,
  ]);

  useEffect(() => {
    const nextFilterResetKey = [
      browseTab,
      categoryId,
      debouncedSearchQuery,
      effectiveVenueScope,
    ].join("|");
    if (previousFilterResetKeyRef.current === nextFilterResetKey) {
      return;
    }
    const previousFilterResetKey = previousFilterResetKeyRef.current;
    previousFilterResetKeyRef.current = nextFilterResetKey;
    if (previousFilterResetKey == null) {
      return;
    }
    const scrollBox = scrollRef.current;
    if (scrollBox) {
      scrollBox.scrollTop = 0;
      scrollBox.scrollLeft = 0;
    }
    const headerScrollBox = headerScrollRef.current;
    if (headerScrollBox) {
      headerScrollBox.scrollLeft = 0;
    }
    setDetailOpen(false);
    setSelectedRowKey((current) => (current == null ? current : null));
    setSelectedDetailMarketKey((current) => (current == null ? current : null));
  }, [
    browseTab,
    categoryId,
    debouncedSearchQuery,
    effectiveVenueScope,
    headerScrollRef,
    previousFilterResetKeyRef,
    scrollRef,
    setDetailOpen,
    setSelectedDetailMarketKey,
    setSelectedRowKey,
  ]);

  useEffect(() => {
    if (visibleRowsLength === 0) {
      if (selectedRowKey !== null) {
        setSelectedRowKey(null);
      }
      if (selectedDetailMarketKey !== null) {
        setSelectedDetailMarketKey(null);
      }
      if (detailOpen) {
        setDetailOpen(false);
      }
    }
  }, [
    detailOpen,
    selectedDetailMarketKey,
    selectedRowKey,
    setDetailOpen,
    setSelectedDetailMarketKey,
    setSelectedRowKey,
    visibleRowsLength,
  ]);

  useEffect(() => {
    if (selectedRowKey == null || selectedRow) {
      return;
    }

    if (detailOpen) {
      setDetailOpen(false);
    }
    if (selectedDetailMarketKey !== null) {
      setSelectedDetailMarketKey(null);
    }
    setSelectedRowKey(null);
  }, [
    detailOpen,
    selectedDetailMarketKey,
    selectedRow,
    selectedRowKey,
    setDetailOpen,
    setSelectedDetailMarketKey,
    setSelectedRowKey,
  ]);

  useEffect(() => {
    if (!detailOpen || !selectedRow) {
      return;
    }

    if (
      selectedDetailMarketKey
      && selectedRow.markets.some(
        (market) => market.key === selectedDetailMarketKey,
      )
    ) {
      return;
    }

    setSelectedDetailMarketKey(selectedRow.focusMarketKey);
  }, [
    detailOpen,
    selectedDetailMarketKey,
    selectedRow,
    setSelectedDetailMarketKey,
  ]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return;
    const viewportHeight = Math.max(
      1,
      Math.min(scrollBox.viewport.height, Math.ceil(appViewportHeight)),
    );
    if (selectedIndex < scrollBox.scrollTop) {
      scrollBox.scrollTop = selectedIndex;
    } else if (
      selectedIndex >=
      scrollBox.scrollTop + viewportHeight
    ) {
      scrollBox.scrollTop = Math.max(
        0,
        selectedIndex - viewportHeight + 1,
      );
    }
  }, [appViewportHeight, scrollRef, selectedIndex]);

  useEffect(() => {
    if (!searchFocused) return;
    searchInputRef.current?.focus?.();
  }, [searchFocused, searchInputRef]);
}
