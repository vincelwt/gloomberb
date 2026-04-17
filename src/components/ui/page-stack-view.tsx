import { Box, Text } from "../../ui";
import { useShortcut } from "../../react/input";
import type { ReactNode } from "react";
import { colors } from "../../theme/colors";
import { isDetailBackNavigationKey } from "../../utils/back-navigation";

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
  useShortcut((event) => {
    if (!focused || !detailOpen || !isDetailBackNavigationKey(event)) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    onBack();
  });

  if (!detailOpen) {
    return (
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {rootContent}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box height={1} flexDirection="row">
        <Box
          onMouseDown={(event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            onBack();
          }}
        >
          <Text fg={colors.textBright}>{`<- ${backLabel}`}</Text>
        </Box>
        <Box flexGrow={1} />
        {backHint ? <Text fg={colors.textMuted}>{backHint}</Text> : null}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {detailContent}
      </Box>
    </Box>
  );
}
