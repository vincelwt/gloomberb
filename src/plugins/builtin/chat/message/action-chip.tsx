import { Box, Text } from "../../../../ui";
import { TextAttributes } from "../../../../ui";
import { colors } from "../../../../theme/colors";

export function ChatActionChip({
  label,
  width,
  emphasized = false,
  onPress,
}: {
  label: string;
  width: number;
  emphasized?: boolean;
  onPress: () => void;
}) {
  const handlePress = (event: any) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onPress();
  };

  return (
    <Box
      width={width}
      height={1}
      backgroundColor={emphasized ? colors.borderFocused : colors.panel}
      onMouseDown={handlePress}
    >
      <Text
        fg={emphasized ? colors.bg : colors.text}
        attributes={emphasized ? TextAttributes.BOLD : 0}
        onMouseDown={handlePress}
      >
        {` ${label} `}
      </Text>
    </Box>
  );
}
