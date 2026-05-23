import type { ReactNode } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { colors, hoverBg } from "../../../theme/colors";

export interface HelpShortcutEntry {
  id: string;
  badges: string[];
  description: string;
  category: string;
}

function ShortcutBadge({ label }: { label: string }) {
  return (
    <Box backgroundColor={colors.selected}>
      <Text fg={colors.selectedText} attributes={TextAttributes.BOLD}>
        {` ${label} `}
      </Text>
    </Box>
  );
}

export function ShortcutRow({
  badges,
  description,
}: {
  badges: string[];
  description: string;
}) {
  return (
    <Box flexDirection="row" gap={1}>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {badges.map((badge) => <ShortcutBadge key={badge} label={badge} />)}
      </Box>
      <Box flexGrow={1}>
        <Text fg={colors.text} wrapText>{description}</Text>
      </Box>
    </Box>
  );
}

export function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
      {children}
    </Box>
  );
}

export function ActionButton({
  id,
  label,
  hovered,
  onHover,
  onPress,
}: {
  id: string;
  label: string;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onPress: () => void;
}) {
  return (
    <Box
      backgroundColor={hovered ? hoverBg() : colors.panel}
      onMouseMove={() => onHover(id)}
      onMouseOut={() => onHover(null)}
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        onPress();
      }}
    >
      <Text fg={hovered ? colors.textBright : colors.text}>{` ${label} `}</Text>
    </Box>
  );
}

export function ShortcutGroup({ title, entries }: { title: string; entries: HelpShortcutEntry[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>{title}</Text>
      {entries.map((entry) => (
        <ShortcutRow
          key={entry.id}
          badges={entry.badges}
          description={entry.description}
        />
      ))}
    </Box>
  );
}
