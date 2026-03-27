import { useState } from "react";
import { colors, hoverBg } from "../../theme/colors";
import { useAppState, useFocusedTicker } from "../../state/app-context";
import { marketStateLabel, marketStateColor, exchangeShortName } from "../../utils/market-status";
import { formatPercentRaw } from "../../utils/format";
import { priceColor } from "../../theme/colors";
import { getSharedRegistry } from "../../plugins/registry";

export function StatusBar() {
  const registry = getSharedRegistry();
  const { state, dispatch } = useAppState();
  const { symbol, financials: focusedFinancials } = useFocusedTicker();
  const [hoveredTab, setHoveredTab] = useState<number | null>(null);
  const refreshCount = state.refreshing.size;

  if (!state.statusBarVisible) return null;

  // Get market state and exchange from the focused ticker context or first available.
  const anyFin = focusedFinancials ?? state.financials.values().next().value ?? null;
  const q = anyFin?.quote;
  const mktState = q?.marketState;
  const exchName = q ? exchangeShortName(q.exchangeName, q.fullExchangeName) : "";

  // Extended hours info for selected ticker
  const selQ = focusedFinancials?.quote;
  let extText = "";
  let extColor = colors.textDim;
  if (selQ?.marketState === "PRE" && selQ.preMarketPrice != null) {
    const chg = selQ.preMarketChangePercent ?? 0;
    extText = `Pre ${selQ.preMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`;
    extColor = priceColor(chg);
  } else if (selQ?.marketState === "POST" && selQ.postMarketPrice != null) {
    const chg = selQ.postMarketChangePercent ?? 0;
    extText = `AH ${selQ.postMarketPrice.toFixed(2)} ${formatPercentRaw(chg)}`;
    extColor = priceColor(chg);
  }

  const layouts = state.config.layouts ?? [];
  const activeLayoutIdx = state.config.activeLayoutIndex ?? 0;
  const hasMultipleLayouts = layouts.length > 1;

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.panel}
    >
      {hasMultipleLayouts ? (
        <box paddingLeft={1} flexShrink={0} flexDirection="row" onMouseLeave={() => setHoveredTab(null)}>
          {layouts.map((l, i) => {
            const isActive = i === activeLayoutIdx;
            const isHovered = hoveredTab === i && !isActive;
            const num = i + 1;
            const bg = isActive ? colors.header : isHovered ? hoverBg() : undefined;
            const fg = isActive ? colors.headerText : isHovered ? colors.text : colors.textDim;
            return (
              <text
                key={i}
                fg={fg}
                bg={bg}
                onMouseMove={() => setHoveredTab(i)}
                onMouseDown={() => dispatch({ type: "SWITCH_LAYOUT", index: i })}
              >
                {` ^${num} `}<span fg={isActive ? colors.headerText : colors.text}>{l.name}</span>{" "}
              </text>
            );
          })}
        </box>
      ) : (
        <box paddingLeft={1}>
          <text fg={colors.textDim}>
            <span fg={colors.text}>Ctrl+P</span> search  <span fg={colors.text}>Tab</span> switch  <span fg={colors.text}>j/k</span> navigate  <span fg={colors.text}>r</span> refresh  <span fg={colors.text}>q</span> quit
          </text>
        </box>
      )}
      <box flexGrow={1} />
      {extText && (
        <box paddingRight={1}>
          <text fg={extColor}>{symbol} {extText}</text>
        </box>
      )}
      {mktState && (
        <box paddingRight={1}>
          <text fg={marketStateColor(mktState)}>
            {exchName ? `${exchName} ` : ""}{marketStateLabel(mktState)}
          </text>
        </box>
      )}
      {/* Plugin status widgets */}
      {registry && <registry.Slot name="status:widget" />}
      {refreshCount > 0 && (
        <box paddingRight={1}>
          <text fg={colors.textDim}>
            refreshing {refreshCount}...
          </text>
        </box>
      )}
    </box>
  );
}
