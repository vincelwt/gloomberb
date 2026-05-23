import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import type { ListViewItem } from "../../ui";
import { getBrokerLabel } from "./utils";

export function BrokerSyncPanel({
  choices,
  selectedBrokerId,
  brokerSyncing,
  brokerSyncError,
}: {
  choices: ListViewItem[];
  selectedBrokerId: string;
  brokerSyncing: boolean;
  brokerSyncError: string | null;
}) {
  const brokerLabel = getBrokerLabel(choices, selectedBrokerId);

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{`Connect ${brokerLabel}`}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={brokerSyncing ? colors.text : colors.negative}>
          {brokerSyncing
            ? `Connecting to ${brokerLabel} and importing accounts and positions...`
            : brokerSyncError || `Unable to sync ${brokerLabel}.`}
        </Text>
      </Box>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textDim}>
          {brokerSyncing
            ? "This happens now so your portfolio is ready before onboarding finishes."
            : "Press Enter to retry, or Backspace to edit the broker settings."}
        </Text>
      </Box>
    </Box>
  );
}
