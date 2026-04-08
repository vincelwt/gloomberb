import { useKeyboard } from "@opentui/react";
import type { ReactNode } from "react";
import { colors } from "../../theme/colors";
import { isBackNavigationKey } from "../../utils/back-navigation";

interface PageStackViewProps {
  focused: boolean;
  detailOpen: boolean;
  onBack: () => void;
  rootContent: ReactNode;
  detailContent: ReactNode;
  backLabel?: string;
  backHint?: string;
}

export function PageStackView({
  focused,
  detailOpen,
  onBack,
  rootContent,
  detailContent,
  backLabel = "Back",
  backHint,
}: PageStackViewProps) {
  useKeyboard((event) => {
    if (!focused || !detailOpen || !isBackNavigationKey(event)) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    onBack();
  });

  if (!detailOpen) {
    return (
      <box flexDirection="column" flexGrow={1}>
        {rootContent}
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box height={1} flexDirection="row">
        <box
          onMouseDown={(event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            onBack();
          }}
        >
          <text fg={colors.textBright}>{`<- ${backLabel}`}</text>
        </box>
        <box flexGrow={1} />
        {backHint ? <text fg={colors.textMuted}>{backHint}</text> : null}
      </box>
      <box flexDirection="column" flexGrow={1}>
        {detailContent}
      </box>
    </box>
  );
}
