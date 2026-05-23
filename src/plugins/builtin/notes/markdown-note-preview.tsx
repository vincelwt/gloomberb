import { Box, ScrollBox, Text } from "../../../ui";
import { MarkdownText } from "../../../components/markdown-text";
import { colors } from "../../../theme/colors";

function noteContentWidth(width: number): number {
  return Math.max(1, Math.floor(width) - 2);
}

export function MarkdownNotePreview({
  text,
  width,
  placeholder,
  onActivate,
}: {
  text: string;
  width: number;
  placeholder: string;
  onActivate: () => void;
}) {
  const lineWidth = noteContentWidth(width);
  const hasText = text.trim().length > 0;

  return (
    <ScrollBox
      flexGrow={1}
      width="100%"
      height="100%"
      scrollY
      focusable={false}
      onMouseDown={onActivate}
    >
      <Box flexDirection="column" flexGrow={1} width={lineWidth}>
        {hasText
          ? <MarkdownText text={text} lineWidth={lineWidth} />
          : <Text fg={colors.textDim}>{placeholder}</Text>}
      </Box>
    </ScrollBox>
  );
}
