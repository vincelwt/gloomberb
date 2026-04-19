import { Box, Text, TextAttributes, useUiHost } from "../../ui";
import { useShortcut } from "../../react/input";
import { type ComponentType, type ReactNode } from "react";
import { colors } from "../../theme/colors";
import { isDetailBackNavigationKey } from "../../utils/back-navigation";

export interface PageStackViewProps {
  focused: boolean;
  detailOpen: boolean;
  onBack: () => void;
  rootContent: ReactNode;
  detailContent: ReactNode;
  detailTitle?: string;
  backLabel?: string;
  backHint?: string;
}

export function PageStackView({
  focused,
  detailOpen,
  onBack,
  rootContent,
  detailContent,
  detailTitle,
  backLabel = "Back",
  backHint,
}: PageStackViewProps) {
  const HostPageStackView = useUiHost().PageStackView as ComponentType<PageStackViewProps> | undefined;
  if (HostPageStackView) {
    return (
      <HostPageStackView
        focused={focused}
        detailOpen={detailOpen}
        onBack={onBack}
        rootContent={rootContent}
        detailContent={detailContent}
        detailTitle={detailTitle}
        backLabel={backLabel}
        backHint={backHint}
      />
    );
  }

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
          <Text fg={colors.textBright}>{`← ${backLabel}`}</Text>
        </Box>
        {detailTitle ? (
          <>
            <Box width={1} flexShrink={0} />
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                {detailTitle}
              </Text>
            </Box>
          </>
        ) : (
          <Box flexGrow={1} />
        )}
        {backHint ? <Text fg={colors.textMuted}>{backHint}</Text> : null}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {detailContent}
      </Box>
    </Box>
  );
}
