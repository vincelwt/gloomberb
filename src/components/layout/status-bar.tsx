import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";

export function StatusBar() {
  const { state } = useAppState();
  const refreshCount = state.refreshing.size;

  if (!state.statusBarVisible) return null;

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
