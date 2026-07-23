import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type InputRenderable } from "../../../ui";
import { InlineQuickAddRow, ListView, type ListViewItem } from "../../../components/ui";
import { useShortcut } from "../../../react/input";
import { useAppInputCapture } from "../../../state/app/input-capture";
import { colors } from "../../../theme/colors";
import type { ChartSpec } from "../../../time-series/types";
import { getSharedRegistry } from "../../registry";
import { MAX_CHART_COMPOSER_SERIES } from "./chart-spec";
import { appendChartSeries } from "./presets";
import type { SeriesCatalogInstrument, SeriesCatalogSuggestion } from "./series-catalog";
import { useSeriesCatalogSuggestions } from "./use-series-catalog";

const MAX_VISIBLE_SUGGESTIONS = 4;
const CHART_TOOLBAR_HEIGHT = 1;
const MINIMUM_CHART_HEIGHT = 4;
const QUICK_ADD_ROW_HEIGHT = 1;

function clampSelection(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(index, length - 1));
}

function defaultCatalogInstrument(spec: ChartSpec): SeriesCatalogInstrument {
  const security = spec.series.find((series) => series.source.kind === "security");
  const instrument = security?.source.kind === "security" ? security.source.instrument : undefined;
  const symbol = instrument?.symbol ?? "AAPL";
  const registry = getSharedRegistry();
  const saved = typeof registry?.getTickerFn === "function"
    ? registry.getTickerFn(symbol)
    : undefined;
  return {
    symbol,
    ...(instrument?.exchange
      ? { exchange: instrument.exchange }
      : saved?.metadata.exchange
        ? { exchange: saved.metadata.exchange }
        : {}),
    ...(saved?.metadata.name ? { name: saved.metadata.name } : {}),
  };
}

export function ChartSeriesQuickAdd({
  spec,
  setSpec,
  focused,
  width,
  height,
  shortcutEnabled,
  shortcutBlocked,
  onActivatePane,
  onActiveChange,
  onHeightChange,
}: {
  spec: ChartSpec;
  setSpec: (spec: ChartSpec) => void;
  focused: boolean;
  width: number;
  height: number;
  shortcutEnabled: boolean;
  shortcutBlocked: boolean;
  onActivatePane: () => void;
  onActiveChange?: (active: boolean) => void;
  onHeightChange?: (height: number) => void;
}) {
  const inputRef = useRef<InputRenderable | null>(null);
  const commitLockRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const defaultInstrument = useMemo(() => defaultCatalogInstrument(spec), [spec]);
  const { suggestions, loading } = useSeriesCatalogSuggestions({
    query,
    defaultInstrument,
    enabled: active,
  });
  const maximumDrawerHeight = Math.max(
    0,
    Math.min(
      MAX_VISIBLE_SUGGESTIONS,
      height - CHART_TOOLBAR_HEIGHT - MINIMUM_CHART_HEIGHT - QUICK_ADD_ROW_HEIGHT,
    ),
  );
  const drawerHeight = active ? Math.min(maximumDrawerHeight, suggestions.length) : 0;
  useAppInputCapture(active && focused);

  useEffect(() => {
    onActiveChange?.(active && focused);
  }, [active, focused, onActiveChange]);

  useEffect(() => {
    onHeightChange?.(1 + drawerHeight);
  }, [drawerHeight, onHeightChange]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, suggestions.length]);

  useEffect(() => {
    if (focused || !active) return;
    setActive(false);
    inputRef.current?.blur?.();
  }, [active, focused]);

  const cancelPendingBlur = useCallback(() => {
    if (blurTimerRef.current === null) return;
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = null;
  }, []);

  useEffect(() => cancelPendingBlur, [cancelPendingBlur]);

  const clearInput = useCallback(() => {
    setQuery("");
    inputRef.current?.editBuffer.setText?.("");
    inputRef.current?.setCursorOffset?.(0);
  }, []);

  const focusInput = useCallback(() => {
    cancelPendingBlur();
    onActivatePane();
    setActive(true);
    setError(null);
    queueMicrotask(() => inputRef.current?.focus?.());
  }, [cancelPendingBlur, onActivatePane]);

  const commitSuggestion = useCallback((suggestion: SeriesCatalogSuggestion | undefined) => {
    if (!suggestion || commitLockRef.current) return;
    cancelPendingBlur();
    if (spec.series.length >= MAX_CHART_COMPOSER_SERIES) {
      setError(`Charts support up to ${MAX_CHART_COMPOSER_SERIES} base series.`);
      return;
    }
    commitLockRef.current = true;
    queueMicrotask(() => {
      commitLockRef.current = false;
    });
    setSpec(appendChartSeries(spec, suggestion.expression).spec);
    clearInput();
    setSelectedIndex(0);
    setError(null);
    queueMicrotask(() => inputRef.current?.focus?.());
  }, [cancelPendingBlur, clearInput, setSpec, spec]);

  const submit = useCallback(() => {
    commitSuggestion(suggestions[clampSelection(selectedIndex, suggestions.length)]);
  }, [commitSuggestion, selectedIndex, suggestions]);
  const cancel = useCallback(() => {
    cancelPendingBlur();
    inputRef.current?.blur?.();
    clearInput();
    setActive(false);
    setError(null);
  }, [cancelPendingBlur, clearInput]);

  useShortcut((event) => {
    if (!focused) return;
    if (!active) {
      if (
        event.name === "n"
        && event.targetEditable !== true
        && !event.ctrl
        && !event.meta
        && !event.super
        && !event.alt
      ) {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusInput();
      }
      return;
    }
    if (event.name === "escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      cancel();
    } else if (event.name === "up") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => clampSelection(current - 1, suggestions.length));
    } else if (event.name === "down") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => clampSelection(current + 1, suggestions.length));
    }
  }, {
    phase: "before",
    allowEditable: true,
    enabled: focused && !shortcutBlocked && (shortcutEnabled || active),
  });

  const items = useMemo<ListViewItem[]>(() => suggestions.map((suggestion) => ({
    id: suggestion.id,
    label: suggestion.label,
    description: suggestion.description,
    detail: suggestion.detail,
  })), [suggestions]);
  const selectedSuggestion = suggestions[clampSelection(selectedIndex, suggestions.length)];
  const preview = error
    ? <Text fg={colors.warning}>{error}</Text>
    : loading
      ? <Text fg={colors.textDim}>Searching instruments…</Text>
      : selectedSuggestion
        ? (
          <Box flexDirection="row" minWidth={0} overflow="hidden">
            <Text fg={active ? colors.text : colors.textDim}>{selectedSuggestion.label}</Text>
            <Text fg={colors.textMuted}>{`  ${selectedSuggestion.description}`}</Text>
          </Box>
        )
        : <Text fg={colors.textMuted}>{active ? "No matching security or metric." : "ticker + metric, e.g. MSFT revenue"}</Text>;

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={1 + drawerHeight}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={colors.panel}
    >
      {drawerHeight > 0 ? (
        <ListView
          items={items}
          selectedIndex={clampSelection(selectedIndex, items.length)}
          height={drawerHeight}
          surface="plain"
          scrollable={items.length > drawerHeight}
          rowGap={0}
          selectOnHover
          onSelect={setSelectedIndex}
          onActivate={(_, index) => commitSuggestion(suggestions[index])}
          remoteLabel="Chart series suggestions"
        />
      ) : null}
      <InlineQuickAddRow
        value={query}
        active={active}
        paneFocused={focused}
        width={width}
        placeholder="add series"
        inputRef={inputRef}
        maxInputWidth={28}
        onFocusRequest={focusInput}
        onChange={(value) => {
          setQuery(value);
          setError(null);
          if (!active) setActive(true);
        }}
        onSubmit={submit}
        onFocus={() => {
          cancelPendingBlur();
          setActive(true);
        }}
        onBlur={() => {
          cancelPendingBlur();
          blurTimerRef.current = setTimeout(() => {
            blurTimerRef.current = null;
            setActive(false);
          }, 0);
        }}
        preview={preview}
        onCancel={cancel}
      />
    </Box>
  );
}
