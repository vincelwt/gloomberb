import { Box } from "../../../ui";
import { Button } from "../../../components";

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
          <Button label={runMode === "force" ? "Force Refreshing..." : "Refreshing..."} variant="secondary" disabled />
          <Button label="Stop" variant="ghost" onPress={onCancelRun} />
        </>
      ) : (
        <>
          <Button
            label={primaryRunLabel}
            variant="primary"
            onPress={onRefresh}
            disabled={!active}
          />
          <Button
            label={forceRunArmed ? "Confirm Force Refresh" : "Force Refresh"}
            variant={forceRunArmed ? "danger" : "ghost"}
            onPress={onForceRefresh}
            disabled={!active}
          />
        </>
      )}
      <Button
        label="Edit Prompt"
        variant={promptDirty ? "primary" : "secondary"}
        onPress={onEdit}
        disabled={!active}
      />
    </Box>
  );
}
