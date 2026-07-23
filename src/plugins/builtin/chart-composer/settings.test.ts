import { describe, expect, test } from "bun:test";
import type { PaneSettingField } from "../../../types/plugin";
import {
  buildComparisonChartPreset,
  buildPriceChartPreset,
  getSelectedBuiltinStudies,
  getSelectedPairStudies,
} from "./presets";
import { CHART_SPEC_SETTING_KEY } from "./chart-spec";
import {
  applyChartComposerPaneSetting,
  buildChartComposerPaneSettingsDef,
  CHART_SETTING_KEYS,
} from "./settings";

function field(key: string, type: PaneSettingField["type"] = "text"): PaneSettingField {
  if (type === "select") return { key, label: key, type, options: [] };
  if (type === "multi-select") return { key, label: key, type, options: [] };
  if (type === "ordered-multi-select") return { key, label: key, type, options: [] };
  if (type === "toggle") return { key, label: key, type };
  return { key, label: key, type };
}

describe("chart composer pane settings", () => {
  test("exposes every authored chart control through the native pane settings model", () => {
    const spec = buildPriceChartPreset("AAPL");
    const definition = buildChartComposerPaneSettingsDef({
      [CHART_SPEC_SETTING_KEY]: spec,
    });

    expect(definition.fields.map((entry) => entry.key)).toEqual([
      CHART_SETTING_KEYS.series,
      CHART_SETTING_KEYS.indicators,
      CHART_SETTING_KEYS.formulas,
      CHART_SETTING_KEYS.dateWindow,
      CHART_SETTING_KEYS.range,
      CHART_SETTING_KEYS.resolution,
      CHART_SETTING_KEYS.mode,
    ]);
    expect(definition.values).toMatchObject({
      [CHART_SETTING_KEYS.series]: "AAPL:market.ohlcv",
      [CHART_SETTING_KEYS.indicators]: ["volume"],
      [CHART_SETTING_KEYS.formulas]: [],
      [CHART_SETTING_KEYS.range]: "5Y",
      [CHART_SETTING_KEYS.resolution]: "auto",
      [CHART_SETTING_KEYS.mode]: "candles",
    });
    expect(definition.applyValue).toBe(applyChartComposerPaneSetting);
  });

  test("updates nested chart state without persisting duplicate derived keys", () => {
    const original = buildPriceChartPreset("AAPL");
    const settings = {
      [CHART_SPEC_SETTING_KEY]: original,
      chartSeries: "stale",
      chartExpression: "stale",
    };
    const nextSettings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.series),
      "MSFT:revenue, AAPL:price",
    );
    const next = nextSettings[CHART_SPEC_SETTING_KEY] as typeof original;

    expect(next.series.map((entry) => (
      entry.source.kind === "security"
        ? [entry.source.instrument.symbol, entry.source.fieldId]
        : []
    ))).toEqual([
      ["MSFT", "fundamental.totalRevenue"],
      ["AAPL", "market.ohlcv"],
    ]);
    expect(next.series[1]?.id).toBe(original.series[0]?.id);
    expect(next.series[1]?.style).toBe("candles");
    expect(getSelectedBuiltinStudies(next)).toEqual(["volume"]);
    expect(nextSettings).not.toHaveProperty(CHART_SETTING_KEYS.series);
    expect(nextSettings).not.toHaveProperty("chartExpression");
  });

  test("applies range, resolution, custom dates, indicators, formulas, and mode to the chart spec", () => {
    let settings: Record<string, unknown> = {
      [CHART_SPEC_SETTING_KEY]: buildComparisonChartPreset(["AAPL", "MSFT"]),
    };
    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.indicators, "multi-select"),
      ["sma20"],
    );
    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.formulas, "multi-select"),
      ["ratio", "correlation"],
    );
    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.dateWindow),
      "2025-01-01 to 2025-06-30",
    );
    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.resolution, "select"),
      "1wk",
    );
    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.mode, "select"),
      "area",
    );
    let spec = settings[CHART_SPEC_SETTING_KEY] as ReturnType<typeof buildComparisonChartPreset>;

    expect(getSelectedBuiltinStudies(spec)).toEqual(["sma20"]);
    expect(getSelectedPairStudies(spec)).toEqual(["ratio", "correlation"]);
    expect(spec.viewport.dateWindow).toEqual({ start: "2025-01-01", end: "2025-06-30" });
    expect(spec.viewport.resolution).toBe("1wk");
    expect(spec.series[0]?.style).toBe("area");

    settings = applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.range, "select"),
      "1Y",
    );
    spec = settings[CHART_SPEC_SETTING_KEY] as ReturnType<typeof buildComparisonChartPreset>;
    expect(spec.viewport.range).toBe("1Y");
    expect(spec.viewport.dateWindow).toBeUndefined();
  });

  test("rejects invalid date windows and incompatible modes", () => {
    const settings = { [CHART_SPEC_SETTING_KEY]: buildPriceChartPreset("AAPL") };
    expect(() => applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.dateWindow),
      "2025-02-30 to 2025-03-01",
    )).toThrow("valid date");
    expect(() => applyChartComposerPaneSetting(
      settings,
      field(CHART_SETTING_KEYS.mode, "select"),
      "columns",
    )).toThrow("not compatible");
  });
});
