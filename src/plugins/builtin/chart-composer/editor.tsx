import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type InputRenderable, useUiHost } from "../../../ui";
import { SegmentedControl } from "../../../components";
import {
  Button,
  Checkbox,
  DialogFrame,
  ListView,
  TextField,
  type ListViewItem,
} from "../../../components/ui";
import { NativeSelect } from "../../../components/ui/native-select";
import { type PromptContext, useDialogKeyboard } from "../../../ui/dialog";
import { colors } from "../../../theme/colors";
import type {
  ChartSeriesSpec,
  ChartSpec,
  SeriesAxis,
  PanelScale,
  SeriesPeriod,
  SeriesStyle,
  SeriesTransform,
} from "../../../time-series/types";
import { validateChartSpec } from "../../../time-series/spec";
import { searchTickerCandidates } from "../../../tickers/search";
import type { TickerRecord } from "../../../types/ticker";
import { isPlainKey } from "../../../utils/keyboard";
import { publicTickerKey } from "../../../utils/exchanges";
import { getSharedRegistry } from "../../registry";
import { MAX_CHART_COMPOSER_SERIES, parseChartSpecOr } from "./chart-spec";
import {
  appendChartSeries,
  buildEmptyChartPreset,
  applySeriesStyle,
  buildSeriesSpec,
  formatSeriesExpression,
  getCompatibleSeriesStyles,
  getCompatibleSeriesTransforms,
  getSelectedBuiltinStudies,
  getSelectedPairStudies,
  parseSeriesExpression,
  setBuiltinStudies,
  setPairStudies,
} from "./presets";
import {
  analyzeSeriesSearchQuery,
  buildSeriesCatalogSuggestions,
  type SeriesCatalogInstrument,
  type SeriesCatalogSuggestion,
} from "./series-catalog";

const AXES: SeriesAxis[] = ["auto", "left", "right"];
const MARKET_PERIODS: SeriesPeriod[] = ["auto", "daily", "weekly", "monthly", "quarterly", "annual"];
const FINANCIAL_PERIODS: SeriesPeriod[] = ["auto", "quarterly", "annual", "ttm"];
const EMPTY_TICKER_CATALOG: ReadonlyMap<string, TickerRecord> = new Map();

function titleCase(value: string): string {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(value, length - 1));
}

function seriesFieldId(series: ChartSeriesSpec): string {
  return series.source.kind === "security" ? series.source.fieldId : series.source.seriesId;
}

function seriesLabel(series: ChartSeriesSpec): string {
  if (series.label) return series.label;
  if (series.source.kind === "economic") return `FRED · ${series.source.seriesId}`;
  return `${publicTickerKey(series.source.instrument.symbol, series.source.instrument.exchange)} · ${series.source.fieldId.split(".").at(-1)}`;
}

function compatiblePeriods(series: ChartSeriesSpec | null): SeriesPeriod[] {
  if (!series || series.source.kind !== "security") return [];
  return series.source.fieldId.startsWith("market.") ? MARKET_PERIODS : FINANCIAL_PERIODS;
}

function DesktopEditorField({
  label,
  children,
  width = "calc(50% - 6px)",
}: {
  label: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <Box flexDirection="column" width={width} minWidth="220px" style={{ gap: 4 }}>
      <Text fg={colors.textDim} style={{ fontWeight: 600 }}>{label}</Text>
      {children}
    </Box>
  );
}

function pruneSpec(spec: ChartSpec): ChartSpec {
  const selectedBuiltinStudies = getSelectedBuiltinStudies(spec);
  const selectedPairStudies = getSelectedPairStudies(spec);
  const rebound = setPairStudies(
    setBuiltinStudies(spec, selectedBuiltinStudies),
    selectedPairStudies,
  );
  const seriesIds = new Set(rebound.series.map((series) => series.id));
  const studies = rebound.studies.filter((study) => {
    const requiredInputs = study.kind === "ratio" || study.kind === "spread" || study.kind === "correlation" ? 2 : 1;
    return study.inputSeriesIds.length === requiredInputs
      && study.inputSeriesIds.every((id) => seriesIds.has(id));
  });
  const usedPanels = new Set(["main", ...rebound.series.map((series) => series.panelId), ...studies.map((study) => study.panelId)]);
  const panels = rebound.panels.filter((panel) => usedPanels.has(panel.id));
  if (!panels.some((panel) => panel.id === "main")) panels.unshift({ id: "main" });
  return { ...rebound, panels, studies };
}

function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((entry, entryIndex) => entryIndex === index ? value : entry);
}

function moveAt<T>(values: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= values.length) return [...values];
  const next = [...values];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export interface SeriesEditorDialogProps extends PromptContext<ChartSpec | null> {
  initialSpec: ChartSpec;
}

export function SeriesEditorDialog({ dialogId, resolve, initialSpec }: SeriesEditorDialogProps) {
  const isDesktop = useUiHost().kind === "desktop-web";
  const [draft, setDraft] = useState(() => parseChartSpecOr(initialSpec, buildEmptyChartPreset()));
  const [selectedIndex, setSelectedIndex] = useState(() => clampIndex(0, initialSpec.series.length));
  const [expression, setExpression] = useState(() => initialSpec.series[0] ? formatSeriesExpression(initialSpec.series[0]) : "");
  const [editingExpression, setEditingExpression] = useState(false);
  const [quickAddActive, setQuickAddActive] = useState(true);
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [quickAddSelection, setQuickAddSelection] = useState(0);
  const [instrumentSearch, setInstrumentSearch] = useState<{
    query: string;
    instruments: SeriesCatalogInstrument[];
    loading: boolean;
  }>({ query: "", instruments: [], loading: false });
  const [error, setError] = useState<string | null>(null);
  const expressionRef = useRef<InputRenderable | null>(null);
  const quickAddRef = useRef<InputRenderable | null>(null);
  const quickAddActiveRef = useRef(true);
  const quickAddAutoFocusUntilRef = useRef(0);
  const catalogCommitLockRef = useRef(false);
  const selected = selectedIndex >= 0 ? draft.series[selectedIndex] ?? null : null;

  useEffect(() => {
    if (!quickAddActive) return;
    quickAddAutoFocusUntilRef.current = Date.now() + 500;
    const focusQuickAdd = () => quickAddRef.current?.focus?.();
    let animationFrame: number | null = null;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    focusQuickAdd();
    queueMicrotask(focusQuickAdd);
    animationFrame = globalThis.requestAnimationFrame?.(focusQuickAdd) ?? null;
    timeouts.push(
      setTimeout(focusQuickAdd, 0),
      setTimeout(focusQuickAdd, 32),
      setTimeout(focusQuickAdd, 64),
    );
    return () => {
      if (animationFrame !== null) globalThis.cancelAnimationFrame?.(animationFrame);
      for (const timeout of timeouts) clearTimeout(timeout);
    };
  }, [quickAddActive]);

  const activateQuickAdd = () => {
    quickAddActiveRef.current = true;
    setQuickAddActive(true);
  };

  const deactivateQuickAdd = () => {
    quickAddActiveRef.current = false;
    quickAddAutoFocusUntilRef.current = 0;
    setQuickAddActive(false);
  };

  useEffect(() => {
    const next = selected ? formatSeriesExpression(selected) : "";
    setExpression(next);
    setError(null);
    setEditingExpression(false);
  }, [selected?.id]);

  const defaultInstrument = useMemo<SeriesCatalogInstrument>(() => {
    const firstSecurity = draft.series.find((series) => series.source.kind === "security");
    const security = selected?.source.kind === "security"
      ? selected.source.instrument
      : firstSecurity?.source.kind === "security"
        ? firstSecurity.source.instrument
        : undefined;
    const symbol = security?.symbol ?? "AAPL";
    const saved = getSharedRegistry()?.getTickerFn(symbol);
    return {
      symbol,
      ...(security?.exchange ? { exchange: security.exchange } : saved?.metadata.exchange ? { exchange: saved.metadata.exchange } : {}),
      ...(saved?.metadata.name ? { name: saved.metadata.name } : {}),
    };
  }, [draft.series, selected]);
  const searchAnalysis = useMemo(
    () => analyzeSeriesSearchQuery(quickAddQuery),
    [quickAddQuery],
  );

  useEffect(() => {
    const query = searchAnalysis.instrumentQuery.trim();
    if (!quickAddActive || !query || searchAnalysis.directInstrument) {
      setInstrumentSearch({ query: "", instruments: [], loading: false });
      return;
    }

    const registry = getSharedRegistry();
    if (!registry) {
      setInstrumentSearch({ query, instruments: [], loading: false });
      return;
    }

    let cancelled = false;
    setInstrumentSearch({ query, instruments: [], loading: true });
    const timer = setTimeout(() => {
      void searchTickerCandidates({
        query,
        tickers: EMPTY_TICKER_CATALOG,
        dataProvider: registry.marketData,
        totalLimit: 4,
        localLimit: 3,
        includeOptionContracts: false,
      }).then((candidates) => {
        if (cancelled) return;
        const instruments = candidates.map((candidate) => ({
          symbol: candidate.symbol,
          ...(candidate.ticker?.metadata.exchange
            ? { exchange: candidate.ticker.metadata.exchange }
            : candidate.result?.primaryExchange || candidate.result?.exchange
              ? { exchange: candidate.result?.primaryExchange || candidate.result?.exchange }
              : {}),
          ...(candidate.ticker?.metadata.name || candidate.result?.name
            ? { name: candidate.ticker?.metadata.name || candidate.result?.name }
            : {}),
        }));
        setInstrumentSearch({ query, instruments, loading: false });
      }).catch(() => {
        if (!cancelled) setInstrumentSearch({ query, instruments: [], loading: false });
      });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    quickAddActive,
    searchAnalysis.directInstrument,
    searchAnalysis.instrumentQuery,
  ]);

  const quickAddSuggestions = useMemo(
    () => buildSeriesCatalogSuggestions(
      quickAddQuery,
      defaultInstrument,
      instrumentSearch.query === searchAnalysis.instrumentQuery
        ? instrumentSearch.instruments
        : [],
    ),
    [
      defaultInstrument,
      instrumentSearch.instruments,
      instrumentSearch.query,
      quickAddQuery,
      searchAnalysis.instrumentQuery,
    ],
  );

  useEffect(() => {
    setQuickAddSelection(0);
  }, [quickAddQuery, quickAddSuggestions.length]);

  const updateSelected = (update: (series: ChartSeriesSpec) => ChartSeriesSpec) => {
    if (!selected) return;
    setDraft((current) => ({
      ...current,
      series: replaceAt(current.series, selectedIndex, update(current.series[selectedIndex]!)),
    }));
  };

  const commitExpression = (): boolean => {
    if (!selected) return false;
    const parsed = parseSeriesExpression(expression);
    if (!parsed) {
      setError("Use SYMBOL, SYMBOL:field, SYMBOL:EXCHANGE:field, or FRED:series.");
      return false;
    }

    const candidate = buildSeriesSpec(parsed, selectedIndex);
    const previousFieldId = seriesFieldId(selected);
    const nextFieldId = seriesFieldId(candidate);
    const styles = getCompatibleSeriesStyles(nextFieldId);
    const transforms = getCompatibleSeriesTransforms(nextFieldId);
    const source = candidate.source.kind === "security" && selected.source.kind === "security"
      ? {
        ...candidate.source,
        ...(previousFieldId === nextFieldId
          ? { period: selected.source.period, timestampMode: selected.source.timestampMode }
          : {}),
        instrument: candidate.source.instrument.symbol === selected.source.instrument.symbol
          && (candidate.source.instrument.exchange ?? "") === (selected.source.instrument.exchange ?? "")
          ? selected.source.instrument
          : candidate.source.instrument,
      }
      : candidate.source;
    const next: ChartSeriesSpec = {
      ...candidate,
      id: selected.id,
      source,
      ...(selected.label ? { label: selected.label } : {}),
      ...(selected.color ? { color: selected.color } : {}),
      ...(selected.visible !== undefined ? { visible: selected.visible } : {}),
      style: previousFieldId === nextFieldId || styles.includes(selected.style) ? selected.style : candidate.style,
      transform: previousFieldId === nextFieldId || transforms.includes(selected.transform)
        ? selected.transform
        : candidate.transform,
      axis: selected.axis,
      panelId: selected.panelId,
      interpolation: previousFieldId === nextFieldId ? selected.interpolation : candidate.interpolation,
    };
    setDraft((current) => ({ ...current, series: replaceAt(current.series, selectedIndex, next) }));
    setExpression(formatSeriesExpression(next));
    setEditingExpression(false);
    expressionRef.current?.blur?.();
    setError(null);
    return true;
  };

  const clearQuickAddInput = () => {
    setQuickAddQuery("");
    quickAddRef.current?.editBuffer.setText?.("");
    quickAddRef.current?.setCursorOffset?.(0);
  };

  const beginQuickAdd = (reset = false) => {
    if (draft.series.length >= MAX_CHART_COMPOSER_SERIES) {
      setError(`Charts support up to ${MAX_CHART_COMPOSER_SERIES} base series.`);
      return;
    }
    if (reset) clearQuickAddInput();
    setEditingExpression(false);
    quickAddAutoFocusUntilRef.current = Date.now() + 500;
    activateQuickAdd();
    setError(null);
    quickAddRef.current?.focus?.();
    if (reset) {
      queueMicrotask(() => {
        clearQuickAddInput();
        quickAddRef.current?.focus?.();
      });
    }
  };

  const addCatalogSuggestion = (suggestion: SeriesCatalogSuggestion | undefined) => {
    if (!suggestion || catalogCommitLockRef.current) return;
    if (draft.series.length >= MAX_CHART_COMPOSER_SERIES) {
      setError(`Charts support up to ${MAX_CHART_COMPOSER_SERIES} base series.`);
      return;
    }
    catalogCommitLockRef.current = true;
    queueMicrotask(() => {
      catalogCommitLockRef.current = false;
    });
    const appended = appendChartSeries(draft, suggestion.expression);
    setDraft(appended.spec);
    setSelectedIndex(appended.spec.series.length - 1);
    setExpression(formatSeriesExpression(appended.series));
    clearQuickAddInput();
    deactivateQuickAdd();
    quickAddRef.current?.blur?.();
    setError(null);
  };

  const submitQuickAdd = (submittedValue?: string) => {
    const query = submittedValue
      ?? quickAddRef.current?.editBuffer.getText()
      ?? quickAddQuery;
    const analysis = analyzeSeriesSearchQuery(query);
    const suggestions = buildSeriesCatalogSuggestions(
      query,
      defaultInstrument,
      instrumentSearch.query === analysis.instrumentQuery
        ? instrumentSearch.instruments
        : [],
    );
    addCatalogSuggestion(suggestions[clampIndex(quickAddSelection, suggestions.length)]);
  };

  const removeSeries = () => {
    if (!selected) return;
    setDraft((current) => pruneSpec({
      ...current,
      series: current.series.filter((_, index) => index !== selectedIndex),
    }));
    setSelectedIndex((current) => clampIndex(current, draft.series.length - 1));
    setError(null);
  };

  const moveSeries = (delta: -1 | 1) => {
    if (!selected) return;
    const target = selectedIndex + delta;
    if (target < 0 || target >= draft.series.length) return;
    setDraft((current) => ({ ...current, series: moveAt(current.series, selectedIndex, delta) }));
    setSelectedIndex(target);
  };

  const beginExpressionEdit = () => {
    if (!selected) return;
    deactivateQuickAdd();
    setEditingExpression(true);
    queueMicrotask(() => expressionRef.current?.focus?.());
  };

  const setSelectedPanel = (panelId: string) => {
    if (!selected || !draft.panels.some((panel) => panel.id === panelId)) return;
    updateSelected((series) => ({ ...series, panelId }));
  };

  const addPanel = () => {
    if (!selected) return;
    const used = new Set(draft.panels.map((panel) => panel.id));
    let index = 2;
    while (used.has(`panel-${index}`)) index += 1;
    const id = `panel-${index}`;
    setDraft((current) => ({
      ...current,
      panels: [...current.panels, { id, label: `Panel ${index}`, height: 0.35, scale: "linear" }],
      series: replaceAt(current.series, selectedIndex, { ...current.series[selectedIndex]!, panelId: id }),
    }));
  };

  const cyclePanel = () => {
    if (!selected || draft.panels.length === 0) return;
    const index = draft.panels.findIndex((panel) => panel.id === selected.panelId);
    setSelectedPanel(draft.panels[(index + 1) % draft.panels.length]?.id ?? "main");
  };

  const setSelectedPanelScale = (scale: PanelScale) => {
    if (!selected) return;
    setDraft((current) => ({
      ...current,
      panels: current.panels.map((panel) => panel.id === selected.panelId ? { ...panel, scale } : panel),
      series: scale === "log"
        ? current.series.map((series) => series.panelId === selected.panelId && series.transform === "log"
          ? { ...series, transform: "raw" }
          : series)
        : current.series,
    }));
  };

  const setSelectedTransform = (transform: SeriesTransform) => {
    if (!selected) return;
    setDraft((current) => ({
      ...current,
      panels: transform === "log"
        ? current.panels.map((panel) => panel.id === selected.panelId ? { ...panel, scale: "linear" } : panel)
        : current.panels,
      series: replaceAt(current.series, selectedIndex, (() => {
        const currentSeries = current.series[selectedIndex]!;
        const ohlcStyle = currentSeries.style === "candles" || currentSeries.style === "ohlc" || currentSeries.style === "hlc";
        return {
          ...currentSeries,
          style: transform !== "raw" && ohlcStyle
            ? getCompatibleSeriesStyles(seriesFieldId(currentSeries)).find((style) => style === "line" || style === "area") ?? "line"
            : currentSeries.style,
          transform,
        };
      })()),
    }));
  };

  const setSelectedStyle = (style: SeriesStyle) => {
    updateSelected((series) => applySeriesStyle(series, style));
  };

  const saveDraft = () => {
    const next = pruneSpec(draft);
    const validation = validateChartSpec(next);
    if (!validation.valid) {
      setError(validation.errors.map((issue) => issue.message).join(" "));
      return;
    }
    resolve(next);
  };

  const toggleSelectedPanelScale = () => {
    const panel = selected ? draft.panels.find((entry) => entry.id === selected.panelId) : null;
    setSelectedPanelScale(panel?.scale === "log" ? "linear" : "log");
  };

  useDialogKeyboard((event) => {
    if (quickAddActive) {
      const printableSequence = (
        !event.ctrl
        && !event.alt
        && !event.meta
        && !event.super
        && event.sequence
        && [...event.sequence].length === 1
        && event.sequence >= " "
      );
      if (isPlainKey(event, "up")) {
        event.stopPropagation();
        event.preventDefault();
        setQuickAddSelection((current) => clampIndex(current - 1, quickAddSuggestions.length));
      } else if (isPlainKey(event, "down")) {
        event.stopPropagation();
        event.preventDefault();
        setQuickAddSelection((current) => clampIndex(current + 1, quickAddSuggestions.length));
      } else if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        event.preventDefault();
        submitQuickAdd();
      } else if (event.name === "escape") {
        event.stopPropagation();
        event.preventDefault();
        clearQuickAddInput();
        deactivateQuickAdd();
        quickAddRef.current?.blur?.();
      } else if (
        event.targetEditable !== true
        && printableSequence
      ) {
        event.stopPropagation();
        event.preventDefault();
        const nextQuery = `${quickAddRef.current?.editBuffer.getText() ?? quickAddQuery}${event.sequence}`;
        quickAddRef.current?.editBuffer.setText?.(nextQuery);
        quickAddRef.current?.setCursorOffset?.(nextQuery.length);
        setQuickAddQuery(nextQuery);
        quickAddAutoFocusUntilRef.current = 0;
        activateQuickAdd();
        quickAddRef.current?.focus?.();
      }
      return;
    }

    if (editingExpression) {
      if (event.name === "escape") {
        event.stopPropagation();
        setExpression(selected ? formatSeriesExpression(selected) : "");
        setEditingExpression(false);
        expressionRef.current?.blur?.();
        setError(null);
      } else if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        commitExpression();
      }
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    if (isPlainKey(event, "up", "k")) {
      setSelectedIndex((current) => clampIndex(current - 1, draft.series.length));
    } else if (isPlainKey(event, "down", "j")) {
      setSelectedIndex((current) => clampIndex(current + 1, draft.series.length));
    } else if (event.name === "[") {
      moveSeries(-1);
    } else if (event.name === "]") {
      moveSeries(1);
    } else if (event.name === "a") {
      beginQuickAdd(true);
    } else if (event.name === "d" || event.name === "delete") {
      removeSeries();
    } else if (event.name === "e") {
      beginExpressionEdit();
    } else if (event.name === "p") {
      cyclePanel();
    } else if (event.name === "n") {
      addPanel();
    } else if (event.name === "l") {
      toggleSelectedPanelScale();
    } else if (event.name === "enter" || event.name === "return") {
      saveDraft();
    } else if (event.name === "escape") {
      resolve(null);
    }
  }, { scope: dialogId, allowEditable: true });

  const items = useMemo<ListViewItem[]>(() => draft.series.map((series) => ({
    id: series.id,
    label: seriesLabel(series),
    description: `${titleCase(series.style)} · ${titleCase(series.transform)} · ${titleCase(series.axis)} axis · ${series.panelId}`,
  })), [draft.series]);
  const quickAddItems = useMemo<ListViewItem[]>(() => quickAddSuggestions.map((suggestion) => ({
    id: suggestion.id,
    label: suggestion.label,
    description: suggestion.description,
    detail: suggestion.detail,
  })), [quickAddSuggestions]);
  const fieldId = selected ? seriesFieldId(selected) : "";
  const styleOptions = selected
    ? getCompatibleSeriesStyles(fieldId).map((value) => ({ value, label: titleCase(value) }))
    : [];
  const transformOptions = selected
    ? getCompatibleSeriesTransforms(fieldId).map((value) => ({ value, label: value === "index100" ? "Index 100" : value.toUpperCase() }))
    : [];
  const selectedPanel = selected ? draft.panels.find((panel) => panel.id === selected.panelId) : null;
  const periodOptions = compatiblePeriods(selected);
  const contentWidth = isDesktop ? "660px" : 76;

  return (
    <DialogFrame
      title="Chart Series"
      footer={isDesktop
        ? undefined
        : "↑↓ select · E source · P panel · L scale · N new panel · A add · D remove · [ ] reorder · Enter save"}
    >
      <Box
        flexDirection="column"
        width={contentWidth}
        gap={1}
        style={isDesktop ? { gap: 10 } : undefined}
      >
        <TextField
          label="Add a series"
          value={quickAddQuery}
          placeholder={`Search ${defaultInstrument.symbol} metrics or type “MSFT revenue”`}
          hint={isDesktop ? "Search by ticker or company and metric. Exact FRED IDs also work." : undefined}
          focused={quickAddActive}
          inputRef={quickAddRef}
          onMouseDown={() => beginQuickAdd()}
          onChange={(value) => {
            setQuickAddQuery(value);
            if (value.trim()) {
              quickAddAutoFocusUntilRef.current = 0;
              activateQuickAdd();
            }
          }}
          onSubmit={submitQuickAdd}
          onBlur={() => {
            if (quickAddActiveRef.current && Date.now() < quickAddAutoFocusUntilRef.current) {
              queueMicrotask(() => {
                if (quickAddActiveRef.current) quickAddRef.current?.focus?.();
              });
              return;
            }
            deactivateQuickAdd();
          }}
        />

        {quickAddQuery.trim() && (
          quickAddItems.length > 0 ? (
            <Box overflow="hidden">
              <ListView
                items={quickAddItems}
                selectedIndex={quickAddSelection}
                height={Math.min(isDesktop ? 5 : 6, quickAddItems.length)}
                surface="framed"
                scrollable={quickAddItems.length > (isDesktop ? 5 : 6)}
                rowGap={isDesktop ? 0 : undefined}
                selectOnHover
                onSelect={setQuickAddSelection}
                onActivate={(_, index) => addCatalogSuggestion(quickAddSuggestions[index])}
              />
            </Box>
          ) : (
            <Text fg={colors.textMuted}>
              {instrumentSearch.loading ? "Searching instruments…" : "No matching security or metric."}
            </Text>
          )
        )}

        {items.length > 0 ? (
          <Box overflow="hidden">
            <ListView
              items={items}
              selectedIndex={selectedIndex}
              height={isDesktop
                ? Math.min(5, items.length)
                : Math.min(7, Math.max(3, items.length))}
              surface={isDesktop ? "plain" : "framed"}
              scrollable={items.length > (isDesktop ? 5 : 7)}
              rowGap={isDesktop ? 0 : undefined}
              selectOnHover
              onSelect={setSelectedIndex}
              onActivate={(_, index) => {
                setSelectedIndex(index);
              }}
            />
          </Box>
        ) : (
          <Box height={2} justifyContent="center" alignItems="center">
            <Text fg={colors.textMuted}>No series yet. Add one to start the chart.</Text>
          </Box>
        )}

        {selected && (
          <Box flexDirection="column" gap={1}>
            <TextField
              label="Source expression"
              value={expression}
              placeholder="AAPL:revenue or FRED:CPIAUCSL"
              focused={editingExpression}
              inputRef={expressionRef}
              onMouseDown={beginExpressionEdit}
              onChange={setExpression}
              onSubmit={() => { commitExpression(); }}
              onBlur={() => { if (editingExpression) commitExpression(); }}
            />

            {isDesktop ? (
              <Box
                flexDirection="row"
                flexWrap="wrap"
                width="100%"
                style={{ columnGap: 12, rowGap: 10 }}
              >
                <DesktopEditorField label="Style">
                  <NativeSelect
                    value={selected.style}
                    options={styleOptions}
                    width="100%"
                    onChange={(value) => setSelectedStyle(value as SeriesStyle)}
                  />
                </DesktopEditorField>
                <DesktopEditorField label="Transform">
                  <NativeSelect
                    value={selected.transform}
                    options={transformOptions}
                    width="100%"
                    onChange={(value) => setSelectedTransform(value as SeriesTransform)}
                  />
                </DesktopEditorField>
                <DesktopEditorField label="Axis">
                  <NativeSelect
                    value={selected.axis}
                    options={AXES.map((value) => ({ value, label: titleCase(value) }))}
                    width="100%"
                    onChange={(value) => updateSelected((series) => ({ ...series, axis: value as SeriesAxis }))}
                  />
                </DesktopEditorField>
                {selected.source.kind === "security" ? (
                  <DesktopEditorField label="Period">
                    <NativeSelect
                      value={selected.source.period ?? "auto"}
                      options={periodOptions.map((value) => ({ value, label: value === "ttm" ? "TTM" : titleCase(value) }))}
                      width="100%"
                      onChange={(value) => updateSelected((series) => series.source.kind === "security" ? ({
                        ...series,
                        source: { ...series.source, period: value as SeriesPeriod },
                      }) : series)}
                    />
                  </DesktopEditorField>
                ) : (
                  <DesktopEditorField label="Visibility">
                    <Box height="28px" justifyContent="center">
                      <Checkbox
                        label="Show series"
                        checked={selected.visible !== false}
                        variant="desktop"
                        onChange={(visible) => updateSelected((series) => ({ ...series, visible }))}
                      />
                    </Box>
                  </DesktopEditorField>
                )}
                <DesktopEditorField label="Panel">
                  <Box flexDirection="row" width="100%" style={{ gap: 6 }}>
                    <Box flexGrow={1} minWidth={0}>
                      <NativeSelect
                        value={selected.panelId}
                        options={draft.panels.map((panel) => ({ value: panel.id, label: panel.label ?? titleCase(panel.id) }))}
                        width="100%"
                        onChange={setSelectedPanel}
                      />
                    </Box>
                    <Button label="New Panel" onPress={addPanel} />
                  </Box>
                </DesktopEditorField>
                <DesktopEditorField label={`Scale (${selectedPanel?.label ?? selected.panelId})`}>
                  <NativeSelect
                    value={selectedPanel?.scale ?? "linear"}
                    options={[
                      { value: "linear", label: "Linear" },
                      { value: "log", label: "Log" },
                    ]}
                    width="100%"
                    onChange={(value) => setSelectedPanelScale(value as PanelScale)}
                  />
                </DesktopEditorField>
                {selected.source.kind === "security" && (
                  <DesktopEditorField label="Visibility" width="100%">
                    <Box height="28px" justifyContent="center">
                      <Checkbox
                        label="Show series"
                        checked={selected.visible !== false}
                        variant="desktop"
                        onChange={(visible) => updateSelected((series) => ({ ...series, visible }))}
                      />
                    </Box>
                  </DesktopEditorField>
                )}
              </Box>
            ) : (
              <>
                <Box flexDirection="column">
                  <Text fg={colors.textDim}>Style</Text>
                  <SegmentedControl
                    options={styleOptions}
                    value={selected.style}
                    onChange={(value) => setSelectedStyle(value as SeriesStyle)}
                  />
                </Box>

                <Box flexDirection="column">
                  <Text fg={colors.textDim}>Transform</Text>
                  <SegmentedControl
                    options={transformOptions}
                    value={selected.transform}
                    onChange={(value) => setSelectedTransform(value as SeriesTransform)}
                  />
                </Box>

                <Box flexDirection="column">
                  <Text fg={colors.textDim}>Axis</Text>
                  <SegmentedControl
                    options={AXES.map((value) => ({ value, label: titleCase(value) }))}
                    value={selected.axis}
                    onChange={(value) => updateSelected((series) => ({ ...series, axis: value as SeriesAxis }))}
                  />
                </Box>

                <Box flexDirection="column">
                  <Text fg={colors.textDim}>Visibility</Text>
                  <SegmentedControl
                    options={[
                      { value: "shown", label: "Shown" },
                      { value: "hidden", label: "Hidden" },
                    ]}
                    value={selected.visible === false ? "hidden" : "shown"}
                    onChange={(value) => updateSelected((series) => ({ ...series, visible: value !== "hidden" }))}
                  />
                </Box>

                <Box flexDirection="column">
                  <Text fg={colors.textDim}>Panel</Text>
                  <Box flexDirection="row" gap={1}>
                    <SegmentedControl
                      options={draft.panels.map((panel) => ({ value: panel.id, label: panel.label ?? titleCase(panel.id) }))}
                      value={selected.panelId}
                      onChange={setSelectedPanel}
                    />
                    <Button label="New Panel" shortcut="N" onPress={addPanel} />
                  </Box>
                </Box>

                <Box flexDirection="column">
                  <Text fg={colors.textDim}>{`Scale (${selectedPanel?.label ?? selected.panelId})`}</Text>
                  <SegmentedControl
                    options={[
                      { value: "linear", label: "Linear" },
                      { value: "log", label: "Log" },
                    ]}
                    value={selectedPanel?.scale ?? "linear"}
                    onChange={(value) => setSelectedPanelScale(value as PanelScale)}
                  />
                </Box>

                {selected.source.kind === "security" && (
                  <Box flexDirection="column">
                    <Text fg={colors.textDim}>Period</Text>
                    <SegmentedControl
                      options={periodOptions.map((value) => ({ value, label: value === "ttm" ? "TTM" : titleCase(value) }))}
                      value={selected.source.period ?? "auto"}
                      onChange={(value) => updateSelected((series) => series.source.kind === "security" ? ({
                        ...series,
                        source: { ...series.source, period: value as SeriesPeriod },
                      }) : series)}
                    />
                  </Box>
                )}
              </>
            )}
          </Box>
        )}

        {error && <Text fg={colors.negative} wrapText>{error}</Text>}

        <Box flexDirection="row" gap={1} width="100%" style={isDesktop ? { gap: 6, paddingTop: 2 } : undefined}>
          {isDesktop ? (
            <>
              <Box flexDirection="row" style={{ gap: 6 }}>
                <Button label="Add Series" onPress={() => beginQuickAdd(true)} disabled={draft.series.length >= MAX_CHART_COMPOSER_SERIES} />
                <Button label="Remove" variant="danger" onPress={removeSeries} disabled={!selected} />
                <Button label="Move Up" onPress={() => moveSeries(-1)} disabled={selectedIndex <= 0} />
                <Button label="Move Down" onPress={() => moveSeries(1)} disabled={selectedIndex < 0 || selectedIndex >= draft.series.length - 1} />
              </Box>
              <Box flexGrow={1} />
              <Box flexDirection="row" style={{ gap: 6 }}>
                <Button label="Cancel" variant="ghost" onPress={() => resolve(null)} />
                <Button label="Save" variant="primary" onPress={saveDraft} />
              </Box>
            </>
          ) : (
            <>
              <Button label="Add Series" shortcut="A" onPress={() => beginQuickAdd(true)} disabled={draft.series.length >= MAX_CHART_COMPOSER_SERIES} />
              <Button label="Remove" shortcut="D" variant="danger" onPress={removeSeries} disabled={!selected} />
              <Button label="Move Up" onPress={() => moveSeries(-1)} disabled={selectedIndex <= 0} />
              <Button label="Move Down" onPress={() => moveSeries(1)} disabled={selectedIndex < 0 || selectedIndex >= draft.series.length - 1} />
              <Button label="Cancel" variant="ghost" onPress={() => resolve(null)} />
              <Button label="Save" variant="primary" onPress={saveDraft} />
            </>
          )}
        </Box>
      </Box>
    </DialogFrame>
  );
}
