import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t } from "../../../i18n";
import { ListView, type ListViewItem } from "../../ui";

export function PortfolioChoicePanel({
  choices,
  optionIdx,
  onOptionSelect,
}: {
  choices: ListViewItem[];
  optionIdx: number;
  onOptionSelect: (idx: number) => void;
}) {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{t("Set up a portfolio")}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textDim}>{t("How would you like to get started?")}</Text>
      </Box>
      <Box height={2} />

      <ListView
        items={choices}
        selectedIndex={optionIdx}
        onSelect={onOptionSelect}
        showSelectedDescription
      />

      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textDim}>{t("Edits later from the command bar.")}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textMuted}>{t("Use \u2191\u2193 to choose")}</Text>
      </Box>
    </Box>
  );
}
