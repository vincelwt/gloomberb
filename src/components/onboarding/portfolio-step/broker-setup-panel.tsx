import { Box, Span, Strong, Text, TextAttributes, Underline } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t } from "../../../i18n";
import { ExternalLink, type ListViewItem } from "../../ui";
import { getBrokerLabel } from "./utils";

export function BrokerSetupPanel({
  choices,
  selectedBrokerId,
  brokerValues,
}: {
  choices: ListViewItem[];
  selectedBrokerId: string;
  brokerValues: Record<string, Record<string, string>>;
}) {
  const brokerLabel = getBrokerLabel(choices, selectedBrokerId);
  const connectionMode = brokerValues[selectedBrokerId]?.connectionMode;
  const isGateway = connectionMode === "gateway";

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {`Setup Guide - ${brokerLabel}`}
        </Text>
      </Box>
      <Box height={1} />

      {selectedBrokerId === "ibkr" && !isGateway && (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("You'll need 2 things from IBKR Account Management:")}</Text>
          </Box>
          <Box height={2} />
          <Box height={1}>
            <Text fg={colors.textDim}>{t("1. Go to ")}<Underline><Span fg={colors.text}>{t("Reports > Flex Queries")}</Span></Underline></Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("2. Create a Flex Query that includes positions data")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("3. Note the ")}<Strong><Span fg={colors.text}>{t("Query ID")}</Span></Strong>{t(" (numeric)")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("4. Under ")}<Underline><Span fg={colors.text}>{t("Reports > Settings")}</Span></Underline>{t(", generate a ")}<Strong><Span fg={colors.text}>{t("Flex Web Service Token")}</Span></Strong></Text>
          </Box>
          <Box height={2} />
          <ExternalLink url="https://www.ibkrguides.com/orgportal/performanceandstatements/flex.htm" />
        </>
      )}

      {selectedBrokerId === "ibkr" && isGateway && (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("You'll need IB Gateway or TWS running locally:")}</Text>
          </Box>
          <Box height={2} />
          <Box height={1}>
            <Text fg={colors.textDim}>{t("1. Download and install ")}<Strong><Span fg={colors.text}>{t("IB Gateway")}</Span></Strong>{t(" (or use TWS)")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("2. Log in with your IBKR credentials")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("3. In ")}<Underline><Span fg={colors.text}>{t("Configuration > API > Settings")}</Span></Underline>{":"}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{"   Enable \"ActiveX and Socket Clients\""}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("   Gloomberb can auto-detect local API ports (4001, 4002, 7496, 7497)")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("   Use Manual setup only if you need a custom host or exact socket port")}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("4. Keep it running while using Gloomberb")}</Text>
          </Box>
          <Box height={2} />
          <ExternalLink url="https://www.interactivebrokers.com/en/trading/ibgateway-stable.php" />
        </>
      )}

      {selectedBrokerId !== "ibkr" && (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{`You'll need your ${brokerLabel} API credentials.`}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("Check your broker's documentation for setup instructions.")}</Text>
          </Box>
        </>
      )}

      <Box height={2} />
    </Box>
  );
}
