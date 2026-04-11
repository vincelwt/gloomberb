import { useEffect, useState } from "react";
import { colors, hoverBg } from "../../theme/colors";
import { useAppState, useFocusedTicker } from "../../state/app-context";
import {
  marketStateLabel,
  marketStateColor,
  exchangeShortName,
  getExtendedHoursInfo,
  quoteSourceLabel,
} from "../../utils/market-status";
import { getSharedRegistry } from "../../plugins/registry";
import { gridlockAllPanes } from "../../plugins/pane-manager";

const GRIDLOCK_TIP_DURATION_MS = 60_000;

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 2) return ".".repeat(width);
  return `${text.slice(0, width - 2)}..`;
}

export function StatusBar() {
  const registry = getSharedRegistry();
  const { state, dispatch } = useAppState();
  const { symbol, financials: focusedFinancials } = useFocusedTicker();
  const [hoveredTab, setHoveredTab] = useState<number | null>(null);
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);

  const q = focusedFinancials?.quote;
  const mktState = q?.marketState;
  const exchName = q
    ? exchangeShortName(q.listingExchangeName ?? q.exchangeName, q.listingExchangeFullName ?? q.fullExchangeName)
    : "";
  const sessionLabel = mktState ? marketStateLabel(mktState) : "?";
  const priceSourceLabel = q?.provenance?.price ? quoteSourceLabel(q.provenance.price, "price") : "";
  const sessionSourceLabel = q?.provenance?.session ? quoteSourceLabel(q.provenance.session, "session") : "";

  // Extended hours info for selected ticker
  const extInfo = getExtendedHoursInfo(focusedFinancials?.quote);
  const extText = extInfo?.text ?? "";
  const extColor = extInfo?.color ?? colors.textDim;

  const layouts = state.config.layouts ?? [];
  const activeLayoutIdx = state.config.activeLayoutIndex ?? 0;
  const hasMultipleLayouts = layouts.length > 1;
  const showGridlockTip = state.gridlockTipVisible && !!registry;

  useEffect(() => {
    if (!state.gridlockTipVisible) return;
    const timer = setTimeout(() => {
      dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
    }, GRIDLOCK_TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dispatch, state.gridlockTipSequence, state.gridlockTipVisible]);

  const handleGridlockTip = (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!registry) return;
    const { width, height } = registry.getTermSizeFn();
    registry.updateLayoutFn(gridlockAllPanes(registry.getLayoutFn(), { x: 0, y: 0, width, height }));
    registry.notify({ body: "Retiled all panes", type: "success" });
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  const dismissGridlockTip = (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  if (!state.statusBarVisible) return null;

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.panel}
    >
      <box paddingLeft={1} flexShrink={0} flexDirection="row">
        {hasMultipleLayouts ? (
          layouts.map((l, i) => {
            const isActive = i === activeLayoutIdx;
            const isHovered = hoveredTab === i && !isActive;
            const num = i + 1;
            const label = truncate(l.name, 14);
            const bg = isActive ? colors.header : isHovered ? hoverBg() : undefined;
            const fg = isActive ? colors.headerText : isHovered ? colors.text : colors.textDim;
            return (
              <text
                key={i}
                fg={fg}
                bg={bg}
                onMouseMove={() => setHoveredTab(i)}
                onMouseDown={(event: any) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dispatch({ type: "SWITCH_LAYOUT", index: i });
                }}
              >
                {` ^${num} `}<span fg={isActive ? colors.headerText : colors.text}>{label}</span>{" "}
              </text>
            );
          })
        ) : (
          <text fg={colors.textDim}>
            <span fg={colors.text}>Ctrl+P</span> command bar
          </text>
        )}
      </box>
      {showGridlockTip && (
        <box paddingLeft={1} flexShrink={0} flexDirection="row">
          <text fg={colors.textDim}>Snapped a window?</text>
          <box width={1} />
          <box
            backgroundColor={hoveredControl === "gridlock-tip" ? hoverBg() : colors.header}
            onMouseMove={() => setHoveredControl("gridlock-tip")}
            onMouseDown={handleGridlockTip}
          >
            <text fg={colors.headerText}> Gridlock All </text>
          </box>
          <text
            fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
            onMouseMove={() => setHoveredControl("gridlock-tip-dismiss")}
            onMouseDown={dismissGridlockTip}
          >
            {" x"}
          </text>
        </box>
      )}
      <box flexGrow={1} />
      {extText && (
        <box paddingRight={1}>
          <text fg={extColor}>{symbol} {extText}</text>
        </box>
      )}
      {(exchName || mktState || q?.provenance?.session) && (
        <box paddingRight={1}>
          <text fg={mktState ? marketStateColor(mktState) : colors.textDim}>
            {exchName ? `${exchName} ` : ""}{sessionLabel}
          </text>
        </box>
      )}
      {priceSourceLabel && (
        <box paddingRight={1}>
          <text fg={colors.textDim}>px {priceSourceLabel}</text>
        </box>
      )}
      {sessionSourceLabel && sessionSourceLabel !== priceSourceLabel && (
        <box paddingRight={1}>
          <text fg={colors.textDim}>ses {sessionSourceLabel}</text>
        </box>
      )}
      {/* Plugin status widgets */}
      {registry && <registry.Slot name="status:widget" />}
    </box>
  );
}
