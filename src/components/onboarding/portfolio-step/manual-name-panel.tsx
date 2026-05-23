import type { RefObject } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { colors } from "../../../theme/colors";
import { TextField } from "../../ui";

export function ManualPortfolioNamePanel({
  portfolioName,
  onNameChange,
  editing,
  inputRef,
}: {
  portfolioName: string;
  onNameChange: (name: string) => void;
  editing: boolean;
  inputRef: RefObject<InputRenderable | null>;
}) {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"Name your portfolio"}</Text>
      </Box>
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textDim}>{"Create watchlists later."}</Text>
      </Box>
      <Box height={2} />
      <Box height={1}>
        <Text fg={colors.text}>{"Portfolio name:"}</Text>
      </Box>
      <Box height={1}>
        {editing ? (
          <TextField
            inputRef={inputRef}
            value={portfolioName}
            placeholder="Main Portfolio"
            focused
            backgroundColor={colors.panel}
            textColor={colors.text}
            placeholderColor={colors.textDim}
            onChange={onNameChange}
            onSubmit={() => {}}
          />
        ) : (
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {`> ${portfolioName}`}
          </Text>
        )}
      </Box>
      <Box height={2} />
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{"After setup, use the command bar ("}</Text>
        <Text fg={colors.text}>{"Ctrl+P"}</Text>
        <Text fg={colors.textDim}>{") and"}</Text>
      </Box>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{"type "}</Text>
        <Text fg={colors.text} attributes={TextAttributes.BOLD}>{"DES AAPL"}</Text>
        <Text fg={colors.textDim}>{" to open security details for a stock or ETF."}</Text>
      </Box>
    </Box>
  );
}
