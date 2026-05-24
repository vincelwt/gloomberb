import { useCallback, useEffect, useRef, useState } from "react";
import { PaneFooterScope } from "../../../components";
import { useShortcut } from "../../../react/input";
import type { PaneProps, TickerResearchTabProps } from "../../../types/plugin";
import {
  useAppDispatch,
  usePaneInstance,
  usePaneTicker,
} from "../../../state/app/context";
import { ChartTab } from "./chart-tab";
import { getTickerResearchPaneSettings } from "./settings";

function TickerChartSurface({
  focused,
  width,
  height,
}: {
  focused: boolean;
  width: number;
  height: number;
}) {
  const dispatch = useAppDispatch();
  const paneInstance = usePaneInstance();
  const { ticker, financials } = usePaneTicker();
  const paneSettings = getTickerResearchPaneSettings(paneInstance?.settings);
  const [interactive, setInteractive] = useState(false);
  const stateRef = useRef({ focused, interactive });
  stateRef.current = { focused, interactive };

  const setInteractiveEager = useCallback((value: boolean) => {
    stateRef.current = { ...stateRef.current, interactive: value };
    setInteractive(value);
  }, []);

  useEffect(() => {
    dispatch({ type: "SET_INPUT_CAPTURED", captured: focused && interactive });
    return () => dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [dispatch, focused, interactive]);

  useShortcut((event) => {
    const current = stateRef.current;
    if (!current.focused) return;
    const isEnter = event.name === "enter" || event.name === "return";
    if (event.name === "escape" && current.interactive) {
      setInteractiveEager(false);
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (isEnter && !current.interactive) {
      setInteractiveEager(true);
      event.preventDefault?.();
      event.stopPropagation?.();
    }
  });

  return (
    <ChartTab
      width={width}
      height={height}
      focused={focused}
      interactive={interactive}
      axisMode={paneSettings.chartAxisMode}
      onActivate={() => setInteractiveEager(true)}
      ticker={ticker}
      financials={financials}
    />
  );
}

export function ChartResearchTab({ focused, width, height }: TickerResearchTabProps) {
  return (
    <TickerChartSurface
      focused={focused}
      width={width}
      height={height}
    />
  );
}

export function TickerChartPane({ focused, width, height }: PaneProps) {
  return (
    <PaneFooterScope active>
      <TickerChartSurface
        focused={focused}
        width={width}
        height={height}
      />
    </PaneFooterScope>
  );
}
