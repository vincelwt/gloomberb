import { Box } from "../../../../ui";
import { Button } from "../../../../components";
import { t } from "../../../../i18n";

export function AiScreenerActionBar({
  active,
  forceRunArmed,
  isRunning,
  primaryRunLabel,
  promptDirty,
  runMode,
  onCancelRun,
  onEdit,
  onForceRefresh,
  onRefresh,
}: {
  active: boolean;
  forceRunArmed: boolean;
  isRunning: boolean;
  primaryRunLabel: string;
  promptDirty: boolean;
  runMode: "refresh" | "force" | null;
  onCancelRun: () => void;
  onEdit: () => void;
  onForceRefresh: () => void;
  onRefresh: () => void;
}) {
  return (
    <Box flexDirection="row" height={1} gap={1}>
      {isRunning ? (
        <>
          <Button label={runMode === "force" ? t("Force Refreshing...") : t("Refreshing...")} variant="secondary" disabled />
          <Button label={t("Stop")} variant="ghost" onPress={onCancelRun} />
        </>
      ) : (
        <>
          <Button
            label={t(primaryRunLabel)}
            variant="primary"
            onPress={onRefresh}
            disabled={!active}
          />
          <Button
            label={forceRunArmed ? t("Confirm Force Refresh") : t("Force Refresh")}
            variant={forceRunArmed ? "danger" : "ghost"}
            onPress={onForceRefresh}
            disabled={!active}
          />
        </>
      )}
      <Button
        label={t("Edit Prompt")}
        variant={promptDirty ? "primary" : "secondary"}
        onPress={onEdit}
        disabled={!active}
      />
    </Box>
  );
}
