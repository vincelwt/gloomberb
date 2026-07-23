import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "../../../ui";
import {
  ChoiceDialog,
  Tabs,
  usePaneFooter,
  type PaneFooterPressEvent,
} from "../../../components";
import {
  MultiSelectDialogButton,
  type MultiSelectDialogButtonHandle,
} from "../../../components/ui";
import { CompositeChart } from "../../../components/chart/composite";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
import type { ChartResolution, TimeRange } from "../../../components/chart/core/types";
import type { ChartSeriesSpec, ChartSpec, SeriesStyle } from "../../../time-series/types";
import { useResolvedChartSpec } from "../../../time-series/hooks";
import { useShortcut } from "../../../react/input";
import { useDialog, useDialogState, type PromptContext } from "../../../ui/dialog";
import {
  useAppDispatch,
  usePaneInstanceId,
  usePaneSettingValue,
  usePaneTicker,
} from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { CHART_COMPOSER_PANE_ID } from "../../../types/config";
import { useRemoteUiNode } from "../../../remote/semantic-tree";
import { SeriesEditorDialog } from "./editor";
import { DateWindowDialog, type DateWindowDialogResult } from "./date-window-dialog";
import { chartComposerSemanticMetadata } from "./semantic";
import {
  CHART_SPEC_SETTING_KEY,
  parseChartSpecOr,
} from "./chart-spec";
import {
  buildEmptyChartPreset,
  buildPriceChartPreset,
  applySeriesStyle,
  getSelectedBuiltinStudies,
  getSelectedPairStudies,
  setBuiltinStudies,
  setPairStudies,
  rebindChartSecuritySymbol,
  type BuiltinStudySelection,
  type PairStudySelection,
} from "./presets";
import {
  CHART_FORMULA_OPTIONS,
  CHART_RANGES as RANGES,
  CHART_RESOLUTIONS as RESOLUTIONS,
  CHART_STUDY_OPTIONS,
  getChartPrimaryStyles,
} from "./settings";
import { resolveChartComposerShortcut } from "./shortcuts";
import { ChartSeriesQuickAdd } from "./quick-add";

const RANGE_TABS = RANGES.map((range, index) => ({ label: `${index + 1}:${range}`, value: range }));
const RESOLUTION_TABS = RESOLUTIONS.map((value) => ({ label: value.toUpperCase(), value }));

function footerAnchorPoint(event?: PaneFooterPressEvent): { x: number; y: number } | undefined {
  const x = event?.pixelX;
  const y = event?.pixelY;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : undefined;
}

export interface ChartComposerSurfaceProps {
  spec: ChartSpec;
  setSpec: (next: ChartSpec) => void;
  focused: boolean;
  width: number;
  height: number;
  footerId: string;
  onCapture?: (capturing: boolean) => void;
}

function replacePrimarySeries(spec: ChartSpec, next: ChartSeriesSpec): ChartSpec {
  return { ...spec, series: [next, ...spec.series.slice(1)] };
}

function isPriceStudyTarget(spec: ChartSpec): boolean {
  return spec.series.some((series) => (
    series.source.kind === "security"
    && (series.source.fieldId === "market.ohlcv" || series.source.fieldId === "market.close")
  ));
}

export function ChartComposerSurface({
  spec,
  setSpec,
  focused,
  width,
  height,
  footerId,
  onCapture,
}: ChartComposerSurfaceProps) {
  const dialog = useDialog();
  const dispatch = useAppDispatch();
  const paneId = usePaneInstanceId();
  const dialogOpen = useDialogState((state) => state.isOpen);
  const resolution = useResolvedChartSpec(spec);
  const selectedStudies = getSelectedBuiltinStudies(spec);
  const selectedPairStudies = getSelectedPairStudies(spec);
  const styles = useMemo(() => getChartPrimaryStyles(spec), [spec]);
  const styleTabs = useMemo(
    () => styles.map((value) => ({ label: value.toUpperCase(), value })),
    [styles],
  );
  const primaryStyle = spec.series[0]?.style ?? "line";
  const viewport = resolution.viewport;
  const baseSeriesIds = useMemo(() => new Set(spec.series.map((series) => series.id)), [spec.series]);
  const [interactionCaptured, setInteractionCapturedState] = useState(false);
  const [quickAddRows, setQuickAddRows] = useState(1);
  const [quickAddWidth, setQuickAddWidth] = useState(14);
  const interactionCaptureRef = useRef(false);
  const interactionCaptureSourcesRef = useRef(new Set<string>());
  const indicatorsDialogRef = useRef<MultiSelectDialogButtonHandle | null>(null);
  const formulasDialogRef = useRef<MultiSelectDialogButtonHandle | null>(null);
  const indicatorsDisabled = !isPriceStudyTarget(spec);
  const formulasDisabled = spec.series.filter((series) => series.visible !== false).length < 2;
  const setInteractionCaptured = useCallback((source: string, captured: boolean) => {
    const sources = interactionCaptureSourcesRef.current;
    if (captured) sources.add(source);
    else sources.delete(source);
    const next = sources.size > 0;
    if (interactionCaptureRef.current === next) return;
    interactionCaptureRef.current = next;
    setInteractionCapturedState(next);
    onCapture?.(next);
  }, [onCapture]);
  const setIndicatorsOpen = useCallback(
    (open: boolean) => setInteractionCaptured("indicators", open),
    [setInteractionCaptured],
  );
  const setFormulasOpen = useCallback(
    (open: boolean) => setInteractionCaptured("formulas", open),
    [setInteractionCaptured],
  );
  const surfaceInteractive = !dialogOpen && !interactionCaptured;
  const shortcutActive = focused && surfaceInteractive;
  const activatePane = useCallback(() => {
    if (!focused) dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch, focused, paneId]);

  useRemoteUiNode({
    role: "chart-data",
    label: "Rendered chart composer data",
    metadata: chartComposerSemanticMetadata(spec, resolution),
  });

  const openSeriesEditor = useCallback(async () => {
    setInteractionCaptured("prompt", true);
    try {
      const next = await dialog.prompt<ChartSpec | null>({
        closeOnClickOutside: false,
        content: (context: PromptContext<ChartSpec | null>) => (
          <SeriesEditorDialog {...context} initialSpec={spec} />
        ),
      }).catch(() => null);
      if (next) setSpec(next);
    } finally {
      setInteractionCaptured("prompt", false);
    }
  }, [dialog, setInteractionCaptured, setSpec, spec]);

  const setRange = useCallback((range: TimeRange) => {
    setSpec({
      ...spec,
      viewport: { ...spec.viewport, range, dateWindow: undefined, maxPoints: undefined },
    });
  }, [setSpec, spec]);
  const openDateWindow = useCallback(async () => {
    setInteractionCaptured("prompt", true);
    try {
      const result = await dialog.prompt<DateWindowDialogResult>({
        closeOnClickOutside: false,
        content: (context: PromptContext<DateWindowDialogResult>) => (
          <DateWindowDialog {...context} initial={spec.viewport.dateWindow} />
        ),
      }).catch(() => null);
      if (result?.kind === "apply") {
        setSpec({
          ...spec,
          viewport: {
            ...spec.viewport,
            dateWindow: { start: result.start, end: result.end },
            maxPoints: undefined,
          },
        });
      } else if (result?.kind === "clear") {
        setSpec({ ...spec, viewport: { ...spec.viewport, dateWindow: undefined } });
      }
    } finally {
      setInteractionCaptured("prompt", false);
    }
  }, [dialog, setInteractionCaptured, setSpec, spec]);
  const setResolution = useCallback((next: ChartResolution) => {
    setSpec({ ...spec, viewport: { ...spec.viewport, resolution: next } });
  }, [setSpec, spec]);
  const setPrimaryStyle = useCallback((style: SeriesStyle) => {
    const primary = spec.series[0];
    if (!primary || !styles.includes(style)) return;
    setSpec(replacePrimarySeries(spec, applySeriesStyle(primary, style)));
  }, [setSpec, spec, styles]);
  const openRangePicker = useCallback(async () => {
    setInteractionCaptured("prompt", true);
    try {
      const range = await dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => (
          <ChoiceDialog
            {...context}
            title="Chart Range"
            selectedChoiceId={spec.viewport.dateWindow ? undefined : spec.viewport.range}
            choices={RANGES.map((value) => ({
              id: value,
              label: value,
              description: `Show the latest ${value === "ALL" ? "available history" : value}.`,
            }))}
          />
        ),
      }).catch(() => "");
      if (RANGES.includes(range as TimeRange)) setRange(range as TimeRange);
    } finally {
      setInteractionCaptured("prompt", false);
    }
  }, [dialog, setInteractionCaptured, setRange, spec.viewport.dateWindow, spec.viewport.range]);
  const openResolutionPicker = useCallback(async () => {
    setInteractionCaptured("prompt", true);
    try {
      const next = await dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => (
          <ChoiceDialog
            {...context}
            title="Chart Resolution"
            selectedChoiceId={spec.viewport.resolution}
            choices={RESOLUTIONS.map((value) => ({
              id: value,
              label: value.toUpperCase(),
              description: value === "auto"
                ? "Choose an interval automatically for the active range."
                : `Use ${value.toUpperCase()} observations.`,
            }))}
          />
        ),
      }).catch(() => "");
      if (RESOLUTIONS.includes(next as ChartResolution)) setResolution(next as ChartResolution);
    } finally {
      setInteractionCaptured("prompt", false);
    }
  }, [dialog, setInteractionCaptured, setResolution, spec.viewport.resolution]);
  const openModePicker = useCallback(async () => {
    if (styles.length === 0) return;
    setInteractionCaptured("prompt", true);
    try {
      const next = await dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => (
          <ChoiceDialog
            {...context}
            title="Chart Mode"
            selectedChoiceId={primaryStyle}
            choices={styles.map((value) => ({
              id: value,
              label: value.toUpperCase(),
              description: `Draw the primary series as ${value}.`,
            }))}
          />
        ),
      }).catch(() => "");
      if (styles.includes(next as SeriesStyle)) setPrimaryStyle(next as SeriesStyle);
    } finally {
      setInteractionCaptured("prompt", false);
    }
  }, [dialog, primaryStyle, setInteractionCaptured, setPrimaryStyle, styles]);
  const toggleSeries = useCallback((seriesId: string) => {
    setSpec({
      ...spec,
      series: spec.series.map((series) => series.id === seriesId
        ? { ...series, visible: series.visible === false }
        : series),
    });
  }, [setSpec, spec]);
  const openIndicators = useCallback((event?: PaneFooterPressEvent) => {
    indicatorsDialogRef.current?.open(footerAnchorPoint(event));
  }, []);
  const openFormulas = useCallback((event?: PaneFooterPressEvent) => {
    formulasDialogRef.current?.open(footerAnchorPoint(event));
  }, []);
  const currentActionsRef = useRef({
    openSeriesEditor,
    openDateWindow,
    openModePicker,
    openResolutionPicker,
    openRangePicker,
    reload: resolution.reload,
  });
  currentActionsRef.current = {
    openSeriesEditor,
    openDateWindow,
    openModePicker,
    openResolutionPicker,
    openRangePicker,
    reload: resolution.reload,
  };
  const footerSeries = useCallback(() => { void currentActionsRef.current.openSeriesEditor(); }, []);
  const footerDates = useCallback(() => { void currentActionsRef.current.openDateWindow(); }, []);
  const footerMode = useCallback(() => { void currentActionsRef.current.openModePicker(); }, []);
  const footerResolution = useCallback(() => { void currentActionsRef.current.openResolutionPicker(); }, []);
  const footerRange = useCallback(() => { void currentActionsRef.current.openRangePicker(); }, []);
  const footerReload = useCallback(() => currentActionsRef.current.reload(), []);

  useShortcut((event) => {
    if (interactionCaptureRef.current || dialogOpen) return;
    const shortcut = resolveChartComposerShortcut(event, RANGES.length);
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();

    if (typeof shortcut !== "string") {
      setRange(RANGES[shortcut.index]!);
      return;
    }
    switch (shortcut) {
      case "reload":
        resolution.reload();
        return;
      case "series":
        void openSeriesEditor();
        return;
      case "dates":
        void openDateWindow();
        return;
      case "mode":
        void openModePicker();
        return;
      case "resolution":
        void openResolutionPicker();
    }
  }, { enabled: focused && !dialogOpen });

  usePaneFooter(footerId, () => ({
    info: [
      ...(resolution.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(resolution.errors[0] ? [{ id: "error", parts: [{ text: resolution.errors[0], tone: "warning" as const }] }] : []),
      ...(!resolution.errors[0] && resolution.warnings[0]
        ? [{ id: "warning", parts: [{ text: resolution.warnings[0], tone: "warning" as const }] }]
        : []),
    ],
    hints: [
      { id: "series", key: "s", label: "eries", onPress: footerSeries },
      { id: "indicators", key: "i", label: "ndicators", onPress: openIndicators, disabled: indicatorsDisabled },
      { id: "formulas", key: "f", label: "ormulas", onPress: openFormulas, disabled: formulasDisabled },
      { id: "dates", key: "w", label: "indow", onPress: footerDates },
      { id: "mode", key: "m", label: "ode", onPress: footerMode, disabled: styles.length === 0 },
      { id: "resolution", key: "r", label: "es", onPress: footerResolution },
      { id: "range", key: "1-8", label: "range", onPress: footerRange },
      { id: "reload", key: "Shift+R", label: "reload", onPress: footerReload },
    ],
  }), [
    footerDates,
    footerMode,
    footerRange,
    footerReload,
    footerResolution,
    footerSeries,
    formulasDisabled,
    indicatorsDisabled,
    openFormulas,
    openIndicators,
    resolution.errors,
    resolution.loading,
    resolution.warnings,
    styles.length,
  ]);

  const emptyMessage = spec.series.length === 0
    ? "Add a series to start the chart"
    : resolution.loading
      ? "Loading chart data"
      : resolution.errors[0] ?? "No observations in this range";

  return (
    <Box flexDirection="column" width={width} height={height} backgroundColor={colors.panel}>
      <Box flexDirection="row" height={1} paddingX={1} gap={1} overflow="hidden">
        <Box flexShrink={0} height={1} maxWidth={52} overflow="hidden">
          <Tabs
            tabs={RANGE_TABS}
            activeValue={spec.viewport.dateWindow ? null : spec.viewport.range}
            onSelect={(value) => setRange(value as TimeRange)}
            compact
            variant="bare"
            focused={focused}
            keyboardNavigation={false}
          />
        </Box>

        <Box flexGrow={1} flexShrink={1} minWidth={0} maxWidth={82} height={1} overflow="hidden">
          <Tabs
            tabs={RESOLUTION_TABS}
            activeValue={spec.viewport.resolution}
            onSelect={(value) => setResolution(value as ChartResolution)}
            compact
            variant="bare"
            focused={focused}
            keyboardNavigation={false}
          />
        </Box>
        {width >= 132 && (
          <Box flexGrow={1} />
        )}
        {width >= 132 && (
          <Box flexShrink={0} maxWidth={48} height={1} overflow="hidden">
            <Tabs
              tabs={styleTabs}
              activeValue={primaryStyle}
              onSelect={(value) => setPrimaryStyle(value as SeriesStyle)}
              compact
              variant="bare"
              focused={focused}
              keyboardNavigation={false}
            />
          </Box>
        )}
      </Box>
      <MultiSelectDialogButton
        ref={indicatorsDialogRef}
        label="Indicators"
        title="Chart Indicators"
        options={CHART_STUDY_OPTIONS}
        selectedValues={selectedStudies}
        onChange={(values) => setSpec(setBuiltinStudies(spec, values as BuiltinStudySelection[]))}
        disabled={indicatorsDisabled}
        idPrefix={`${footerId}:indicators`}
        shortcutKey="i"
        shortcutActive={shortcutActive}
        onOpenChange={setIndicatorsOpen}
        renderTrigger={() => null}
      />
      <MultiSelectDialogButton
        ref={formulasDialogRef}
        label="Formulas"
        title="Pair Formulas"
        options={CHART_FORMULA_OPTIONS}
        selectedValues={selectedPairStudies}
        onChange={(values) => setSpec(setPairStudies(spec, values as PairStudySelection[]))}
        disabled={formulasDisabled}
        idPrefix={`${footerId}:formulas`}
        shortcutKey="f"
        shortcutActive={shortcutActive}
        onOpenChange={setFormulasOpen}
        renderTrigger={() => null}
      />

      <Box flexGrow={1} minHeight={4}>
        <CompositeChart
          series={resolution.bufferedSeries ?? resolution.series}
          panels={spec.panels}
          viewport={viewport}
          width={Math.max(1, width)}
          height={Math.max(4, height - 1)}
          focused={focused}
          interactive={surfaceInteractive}
          onActivate={activatePane}
          onToggleSeries={toggleSeries}
          isSeriesToggleable={(series) => baseSeriesIds.has(series.id)}
          emptyMessage={emptyMessage}
          legendAccessory={(
            <ChartSeriesQuickAdd
              spec={spec}
              setSpec={setSpec}
              focused={focused}
              width={Math.max(8, Math.min(36, width - 1))}
              height={height}
              shortcutEnabled={surfaceInteractive}
              shortcutBlocked={dialogOpen}
              onActivatePane={activatePane}
              onActiveChange={(active) => setInteractionCaptured("quick-add", active)}
              onHeightChange={setQuickAddRows}
              onWidthChange={setQuickAddWidth}
            />
          )}
          legendAccessoryRows={quickAddRows}
          legendAccessoryWidth={quickAddWidth}
        />
      </Box>
    </Box>
  );
}

export function ChartComposerPane({ paneId, focused, width, height }: PaneProps) {
  const { symbol } = usePaneTicker();
  const fallback = useMemo(
    () => symbol ? buildPriceChartPreset(symbol) : buildEmptyChartPreset(),
    [symbol],
  );
  const [storedSpec, setStoredSpec] = usePaneSettingValue<unknown>(CHART_SPEC_SETTING_KEY, fallback);
  const spec = useMemo(() => parseChartSpecOr(storedSpec, fallback), [fallback, storedSpec]);
  return (
    <ChartComposerSurface
      spec={spec}
      setSpec={setStoredSpec}
      focused={focused}
      width={width}
      height={height}
      footerId={`${CHART_COMPOSER_PANE_ID}:${paneId}`}
    />
  );
}

export function ChartComposerResearchTab({ focused, width, height, onCapture }: TickerResearchTabProps) {
  const { symbol } = usePaneTicker();
  const fallback = useMemo(() => symbol ? buildPriceChartPreset(symbol) : buildEmptyChartPreset(), [symbol]);
  const [storedSpec, setStoredSpec] = usePaneSettingValue<unknown>(CHART_SPEC_SETTING_KEY, fallback);
  const spec = useMemo(() => parseChartSpecOr(storedSpec, fallback), [fallback, storedSpec]);
  const previousSymbolRef = useRef(symbol);

  useEffect(() => {
    const previousSymbol = previousSymbolRef.current;
    previousSymbolRef.current = symbol;
    if (!symbol || !previousSymbol || symbol === previousSymbol) return;
    const rebound = rebindChartSecuritySymbol(spec, previousSymbol, symbol);
    if (rebound !== spec) setStoredSpec(rebound);
  }, [setStoredSpec, spec, symbol]);

  return (
    <ChartComposerSurface
      spec={spec}
      setSpec={setStoredSpec}
      focused={focused}
      width={width}
      height={height}
      footerId="chart-composer:research"
      onCapture={onCapture}
    />
  );
}
