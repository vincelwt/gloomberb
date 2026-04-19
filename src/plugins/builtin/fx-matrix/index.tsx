import { Box, ScrollBox, Text } from "../../../ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { usePaneFooter } from "../../../components";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, blendHex } from "../../../theme/colors";
import { usePluginDataProvider } from "../../plugin-runtime";
import { MAJOR_CURRENCIES, CURRENCY_FLAGS, formatRate, type MajorCurrency } from "./pairs";

const REFRESH_INTERVAL_MS = 60_000;

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function FxMatrixPane({ focused, width, height }: PaneProps) {
  const dataProvider = usePluginDataProvider();
  const [rates, setRates] = useState<Map<MajorCurrency, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const fetchGenRef = useRef(0);

  const fetchRates = useCallback(async () => {
    if (!dataProvider) return;

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;

    try {
      const results = await Promise.allSettled(
        MAJOR_CURRENCIES.map(async (currency) => {
          if (currency === "USD") return { currency, rate: 1 };
          const rate = await dataProvider.getExchangeRate(currency);
          return { currency, rate };
        }),
      );

      if (fetchGenRef.current !== gen) return;

      const newRates = new Map<MajorCurrency, number>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          newRates.set(result.value.currency as MajorCurrency, result.value.rate);
        }
      }

      setRates(newRates);
      setLastRefreshed(Date.now());
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, [dataProvider]);

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRates]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(interval);
  }, []);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "r") {
      fetchRates();
    }
  });

  const headerBg = blendHex(colors.bg, colors.border, 0.3);

  function crossRate(row: MajorCurrency, col: MajorCurrency): number | null {
    if (row === col) return 1;
    const rowUsd = rates.get(row);
    const colUsd = rates.get(col);
    if (rowUsd == null || colUsd == null) return null;
    return rowUsd / colUsd;
  }

  const ageText = lastRefreshed ? `updated ${formatAge(now - lastRefreshed)}` : loading ? "loading…" : "";

  usePaneFooter("fx-matrix", () => ({
    info: ageText ? [{ id: "updated", parts: [{ text: ageText, tone: loading ? "muted" : "value" }] }] : [],
    hints: [{ id: "refresh", key: "r", label: "efresh", onPress: fetchRates }],
  }), [ageText, fetchRates, loading]);

  // Row header: just the 3-letter code, no emoji (keeps width predictable)
  // Rates use flexGrow so they fill available space dynamically

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Column header row */}
      <Box flexDirection="row" paddingX={1} height={1} backgroundColor={headerBg}>
        <Box width={5} flexShrink={0} />
        {MAJOR_CURRENCIES.map((col) => (
          <Box key={col} flexGrow={1} justifyContent="flex-end" paddingRight={1}>
            <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>{col}</Text>
          </Box>
        ))}
      </Box>

      {/* Matrix rows */}
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {loading && rates.size === 0 ? (
            <Box paddingX={1} paddingY={1}>
              <Text fg={colors.textMuted}>Fetching rates…</Text>
            </Box>
          ) : (
            MAJOR_CURRENCIES.map((row) => (
              <Box key={row} flexDirection="row" paddingX={1}>
                <Box width={5} flexShrink={0}>
                  <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{row}</Text>
                </Box>
                {MAJOR_CURRENCIES.map((col) => {
                  const rate = crossRate(row, col);
                  const isDiag = row === col;
                  return (
                    <Box key={col} flexGrow={1} justifyContent="flex-end" paddingRight={1}>
                      {rate == null ? (
                        <Text fg={colors.textDim}>—</Text>
                      ) : (
                        <Text fg={isDiag ? colors.textDim : colors.text}>
                          {formatRate(rate, col)}
                        </Text>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))
          )}
        </Box>
      </ScrollBox>
    </Box>
  );
}

export const fxMatrixPlugin: GloomPlugin = {
  id: "fx-matrix",
  name: "FX Cross Rates",
  version: "1.0.0",
  description: "Currency cross-rate matrix for major FX pairs",
  toggleable: true,

  panes: [
    {
      id: "fx-matrix",
      name: "FX Cross Rates",
      icon: "F",
      component: FxMatrixPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 14 },
    },
  ],

  paneTemplates: [
    {
      id: "fx-matrix-pane",
      paneId: "fx-matrix",
      label: "FX Cross Rates",
      description: "Currency cross-rate matrix for major FX pairs.",
      keywords: ["fx", "forex", "currency", "exchange", "rates", "cross", "matrix"],
      shortcut: { prefix: "FXC" },
    },
  ],
};
