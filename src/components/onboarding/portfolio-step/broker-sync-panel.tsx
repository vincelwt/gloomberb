import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t, tf } from "../../../i18n";
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
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{tf("Connect {broker}", { broker: brokerLabel })}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={brokerSyncing ? colors.text : colors.negative}>
          {brokerSyncing
            ? tf("Connecting to {broker} and importing accounts and positions...", { broker: brokerLabel })
            : brokerSyncError || tf("Unable to sync {broker}.", { broker: brokerLabel })}
        </Text>
      </Box>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.textDim}>
          {brokerSyncing
            ? t("This happens now so your portfolio is ready before onboarding finishes.")
            : t("Press Enter to retry, or Backspace to edit the broker settings.")}
        </Text>
      </Box>
    </Box>
  );
}
