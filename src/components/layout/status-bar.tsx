import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { marketStateLabel, marketStateColor, exchangeShortName } from "../../utils/market-status";
import { formatPercentRaw } from "../../utils/format";
import { priceColor } from "../../theme/colors";

function UpdateStatus() {
  const { state } = useAppState();
  const { updateAvailable, updateProgress } = state;

  if (updateProgress) {
    if (updateProgress.phase === "downloading") {
      return (
        <text fg={colors.textBright}>
          Downloading v{updateAvailable?.version}... {updateProgress.percent ?? 0}%
        </text>
      );
    }
    if (updateProgress.phase === "replacing") {
      return <text fg={colors.textBright}>Installing update...</text>;
    }
    if (updateProgress.phase === "done") {
      return <text fg={colors.positive}>Update installed — restart to apply</text>;
    }
    if (updateProgress.phase === "error") {
      return <text fg={colors.negative}>Update failed: {updateProgress.error}</text>;
    }
  }

  if (updateAvailable) {
    return (
      <text fg={colors.textBright}>
        v{updateAvailable.version} available — press <span fg={colors.text}>u</span> to update
      </text>
    );
  }

  return null;
}

export function StatusBar() {
  const { state } = useAppState();
  const refreshCount = state.refreshing.size;

  if (!state.statusBarVisible) return null;

  // Get market state and exchange from selected ticker or first available
  const selectedFin = state.selectedTicker ? state.financials.get(state.selectedTicker) : null;
  const anyFin = selectedFin ?? state.financials.values().next().value ?? null;
  const q = anyFin?.quote;
  const mktState = q?.marketState;
  const exchName = q ? exchangeShortName(q.exchangeName, q.fullExchangeName) : "";

  // Extended hours info for selected ticker
  const selQ = selectedFin?.quote;
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

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={colors.panel}
    >
      <box flexGrow={1} paddingLeft={1}>
        <text fg={colors.textDim}>
          <span fg={colors.text}>Ctrl+P</span> search  <span fg={colors.text}>Tab</span> switch  <span fg={colors.text}>j/k</span> navigate  <span fg={colors.text}>r</span> refresh  <span fg={colors.text}>q</span> quit
        </text>
      </box>
      {extText && (
        <box paddingRight={1}>
          <text fg={extColor}>{state.selectedTicker} {extText}</text>
        </box>
      )}
      {mktState && (
        <box paddingRight={1}>
          <text fg={marketStateColor(mktState)}>
            {exchName ? `${exchName} ` : ""}{marketStateLabel(mktState)}
          </text>
        </box>
      )}
      <box paddingRight={1}>
        <UpdateStatus />
      </box>
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
