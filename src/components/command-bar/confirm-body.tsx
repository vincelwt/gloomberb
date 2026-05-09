import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { Button, Spinner } from "../ui";
import { truncateText } from "./view-model";
import type { CommandBarConfirmRoute } from "./workflow-types";

export function CommandBarConfirmBody({
  route,
  bodyHeight,
  contentPadding,
  paletteText,
  queryDisplayWidth,
  onConfirm,
}: {
  route: CommandBarConfirmRoute;
  bodyHeight: number;
  contentPadding: number;
  paletteText: string;
  queryDisplayWidth: number;
  onConfirm: () => void;
}) {
  return (
    <Box flexDirection="column" height={bodyHeight} paddingX={contentPadding}>
      {route.body.map((line, index) => (
        <Box key={`confirm:${index}`} height={1}>
          <Text fg={paletteText}>{truncateText(line, queryDisplayWidth)}</Text>
        </Box>
      ))}
      <Box height={1} />
      {route.error && (
        <Box height={1}>
          <Text fg={colors.negative}>{truncateText(route.error, queryDisplayWidth)}</Text>
        </Box>
      )}
      {route.pending && (
        <Box height={1}>
          <Spinner label="Working…" />
        </Box>
      )}
      <Box flexGrow={1} />
      <Box flexDirection="row" gap={1}>
        <Button
          label={route.confirmLabel}
          variant={route.tone === "danger" ? "danger" : "primary"}
          onPress={onConfirm}
          disabled={route.pending}
        />
      </Box>
    </Box>
  );
}
