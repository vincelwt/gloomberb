import { Box, Span, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { useEffect, useState } from "react";
import { colors, hoverBg } from "../../theme/colors";
import { useAppDispatch, useAppSelector, useFocusedTicker } from "../../state/app-context";
import {
  selectActiveLayoutIndex,
  selectGridlockTipSequence,
  selectGridlockTipVisible,
  selectSavedLayouts,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
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
  const { nativePaneChrome } = useUiCapabilities();
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const layouts = useAppSelector(selectSavedLayouts);
  const activeLayoutIdx = useAppSelector(selectActiveLayoutIndex);
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const gridlockTipVisible = useAppSelector(selectGridlockTipVisible);
  const gridlockTipSequence = useAppSelector(selectGridlockTipSequence);
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

  const hasMultipleLayouts = layouts.length > 1;
  const showGridlockTip = gridlockTipVisible && !!registry;

  useEffect(() => {
    if (!gridlockTipVisible) return;
    const timer = setTimeout(() => {
      dispatch({ type: "DISMISS_GRIDLOCK_TIP" });
    }, GRIDLOCK_TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dispatch, gridlockTipSequence, gridlockTipVisible]);

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

  if (!statusBarVisible) return null;

  if (nativePaneChrome) {
    return (
      <Box
        flexDirection="row"
        height={1}
        alignItems="center"
        backgroundColor={colors.panel}
        data-gloom-role="status-bar"
        style={{
          borderTop: `1px solid ${colors.border}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          paddingInline: 8,
        }}
      >
        <Box paddingLeft={1} flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
          {hasMultipleLayouts ? (
            layouts.map((layout, index) => {
              const active = index === activeLayoutIdx;
              const hovered = hoveredTab === index && !active;
              return (
                <Box
                  key={layout.name}
                  height={1}
                  flexDirection="row"
                  alignItems="center"
                  backgroundColor={active ? "rgba(84, 201, 159, 0.10)" : hovered ? "rgba(255,255,255,0.04)" : undefined}
                  onMouseMove={() => setHoveredTab((current) => (current === index ? current : index))}
                  onMouseDown={(event) => {
                    event?.preventDefault?.();
                    event?.stopPropagation?.();
                    dispatch({ type: "SWITCH_LAYOUT", index });
                  }}
                  data-gloom-interactive="true"
                  style={{
                    borderRadius: 4,
                    paddingInline: 4,
                    cursor: "pointer",
                  }}
                >
                  <Text fg={active ? colors.borderFocused : colors.textDim}>
                    ^{index + 1}
                  </Text>
                  <Text
                    fg={active ? colors.textBright : hovered ? colors.text : colors.textDim}
                    attributes={active ? TextAttributes.BOLD : 0}
                    style={{ marginLeft: 6 }}
                  >
                    {truncate(layout.name, 14)}
                  </Text>
                </Box>
              );
            })
          ) : (
            <Text fg={colors.textDim}>
              <Span fg={colors.text}>Ctrl+P</Span> command bar
            </Text>
          )}
        </Box>
        {showGridlockTip && (
          <Box paddingLeft={2} flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
            <Text fg={colors.textDim}>Snapped a window?</Text>
            <Text
              fg={hoveredControl === "gridlock-tip" ? colors.textBright : colors.borderFocused}
              attributes={TextAttributes.BOLD}
              onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
              onMouseDown={handleGridlockTip}
              data-gloom-interactive="true"
            >
              Gridlock All
            </Text>
            <Text
              fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
              onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
              onMouseDown={dismissGridlockTip}
              data-gloom-interactive="true"
            >
              Dismiss
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
          <Box
            paddingRight={1}
            height={1}
            flexDirection="row"
            alignItems="center"
            backgroundColor="rgba(8, 12, 15, 0.30)"
            style={{
              border: "1px solid rgba(132, 145, 161, 0.22)",
              borderRadius: 5,
              paddingInline: 6,
            }}
          >
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
        <PluginSlot name="status:widget" />
      </Box>
    );
  }

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
                onMouseMove={() => setHoveredTab((current) => (current === i ? current : i))}
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
            onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip" ? current : "gridlock-tip"))}
            onMouseDown={handleGridlockTip}
          >
            <Text fg={colors.headerText}> Gridlock All </Text>
          </Box>
          <Text
            fg={hoveredControl === "gridlock-tip-dismiss" ? colors.text : colors.textDim}
            onMouseMove={() => setHoveredControl((current) => (current === "gridlock-tip-dismiss" ? current : "gridlock-tip-dismiss"))}
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
