import { Box, Span, Text } from "../../ui";
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
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import { PluginSlot } from "../../react/plugins/plugin-slot";

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
    notifyGridlockComplete(registry.notify.bind(registry), () => {
      dispatch({ type: "UNDO_LAYOUT" });
    });
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  const dismissGridlockTip = (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
  };

  if (!state.statusBarVisible) return null;

  return (
    <Box
      flexDirection="row"
      height={1}
      alignItems="center"
      backgroundColor={colors.panel}
      data-gloom-role="status-bar"
    >
      <Box paddingLeft={1} flexShrink={0} flexDirection="row">
        {hasMultipleLayouts ? (
          layouts.map((l, i) => {
            const isActive = i === activeLayoutIdx;
            const isHovered = hoveredTab === i && !isActive;
            const num = i + 1;
            const label = truncate(l.name, 14);
            const bg = isActive ? colors.header : isHovered ? hoverBg() : undefined;
            const fg = isActive ? colors.headerText : isHovered ? colors.text : colors.textDim;
            return (
              <Text
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
                {` ^${num} `}<Span fg={isActive ? colors.headerText : colors.text}>{label}</Span>{" "}
              </Text>
            );
          })
        ) : (
          <Text fg={colors.textDim}>
            <Span fg={colors.text}>Ctrl+P</Span> command bar
          </Text>
        )}
      </Box>
      {showGridlockTip && (
        <Box paddingLeft={1} flexShrink={0} flexDirection="row">
          <Text fg={colors.textDim}>Snapped a window?</Text>
          <Box width={1} />
          <Box
            backgroundColor={hoveredControl === "gridlock-tip" ? hoverBg() : colors.header}
            onMouseMove={() => setHoveredControl("gridlock-tip")}
            onMouseDown={handleGridlockTip}
          >
            <Text fg={colors.headerText}> Gridlock All </Text>
          </Box>
          <Text
            fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
            onMouseMove={() => setHoveredControl("gridlock-tip-dismiss")}
            onMouseDown={dismissGridlockTip}
          >
            {" x"}
          </Text>
        </Box>
      )}
      <Box flexGrow={1} />
      {extText && (
        <Box paddingRight={1}>
          <Text fg={extColor}>{symbol} {extText}</Text>
        </Box>
      )}
      {(exchName || mktState || q?.provenance?.session) && (
        <Box paddingRight={1}>
          <Text fg={mktState ? marketStateColor(mktState) : colors.textDim}>
            {exchName ? `${exchName} ` : ""}{sessionLabel}
          </Text>
        </Box>
      )}
      {priceSourceLabel && (
        <Box paddingRight={1}>
          <Text fg={colors.textDim}>px {priceSourceLabel}</Text>
        </Box>
      )}
      {sessionSourceLabel && sessionSourceLabel !== priceSourceLabel && (
        <Box paddingRight={1}>
          <Text fg={colors.textDim}>ses {sessionSourceLabel}</Text>
        </Box>
      )}
      {/* Plugin status widgets */}
      <PluginSlot name="status:widget" />
    </Box>
  );
}
