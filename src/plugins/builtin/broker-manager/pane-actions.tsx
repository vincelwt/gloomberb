import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ConfirmDialog } from "../../../components";
import {
  buildBrokerProfileConfig,
  createBrokerProfileDraft,
  validateBrokerProfileValues,
  type BrokerProfileDraft,
} from "../../../brokers/profile-form";
import type { BrokerProfileAction } from "../../../types/broker";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { usePluginAppActions, usePluginBrokerActions } from "../../runtime";
import type { BrokerEditKey } from "./detail";
import type { BrokerProfileRow } from "./model";

export function useBrokerManagerActions({
  selectedRow,
  editDraft,
  setEditDraft,
  setActiveEditKey,
  setDetailOpen,
  refreshStatuses,
}: {
  selectedRow: BrokerProfileRow | null;
  editDraft: BrokerProfileDraft | null;
  setEditDraft: Dispatch<SetStateAction<BrokerProfileDraft | null>>;
  setActiveEditKey: Dispatch<SetStateAction<BrokerEditKey>>;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  refreshStatuses: () => void;
}) {
  const dialog = useDialog();
  const { openCommandBar, showPane } = usePluginAppActions();
  const {
    connectBrokerInstance,
    updateBrokerInstance,
    syncBrokerInstance,
    removeBrokerInstance,
  } = usePluginBrokerActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openAddBroker = useCallback(() => {
    openCommandBar("Add Broker Account");
  }, [openCommandBar]);

  const startEdit = useCallback(() => {
    if (!selectedRow?.adapter) {
      setMessage("Broker plugin is not available.");
      return;
    }
    const draft = createBrokerProfileDraft(selectedRow.adapter, selectedRow.instance);
    for (const field of selectedRow.adapter.configSchema) {
      if (field.type === "password" && draft.values[field.key]) draft.values[field.key] = "";
    }
    setEditDraft(draft);
    setActiveEditKey("label");
    setMessage(null);
    setDetailOpen(true);
  }, [selectedRow, setActiveEditKey, setDetailOpen, setEditDraft]);

  const saveEdit = useCallback(async () => {
    if (!selectedRow?.adapter || !editDraft) return;
    const label = editDraft.label.trim();
    if (!label) {
      setMessage("Profile label is required.");
      return;
    }
    const validationError = validateBrokerProfileValues(selectedRow.adapter, editDraft.values, selectedRow.instance);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    try {
      setBusy("Saving…");
      const nextConfig = buildBrokerProfileConfig(selectedRow.adapter, editDraft.values, selectedRow.instance);
      await updateBrokerInstance(selectedRow.id, nextConfig, {
        label,
        enabled: editDraft.enabled,
        replaceConfig: true,
      });
      setEditDraft(null);
      setMessage(`Saved ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save broker profile.");
    } finally {
      setBusy(null);
    }
  }, [editDraft, selectedRow, setEditDraft, updateBrokerInstance]);

  const connectSelected = useCallback(async () => {
    if (!selectedRow) return;
    try {
      setBusy("Testing…");
      await connectBrokerInstance(selectedRow.id);
      refreshStatuses();
      setMessage(`Tested ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to test ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [connectBrokerInstance, refreshStatuses, selectedRow]);

  const syncSelected = useCallback(async () => {
    if (!selectedRow) return;
    try {
      setBusy("Syncing…");
      await syncBrokerInstance(selectedRow.id);
      refreshStatuses();
      setMessage(`Synced ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to sync ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [refreshStatuses, selectedRow, syncBrokerInstance]);

  const selectedProfileActions = useMemo(
    () => selectedRow?.adapter?.getProfileActions?.(selectedRow.instance) ?? [],
    [selectedRow],
  );
  const primaryProfileAction = selectedProfileActions[0] ?? null;

  const openProfileAction = useCallback((action: BrokerProfileAction | null = primaryProfileAction) => {
    if (!action) return;
    if (action.disabled) {
      setMessage(action.disabledReason ?? `${action.label} is unavailable for this profile.`);
      return;
    }
    if (action.paneId) showPane(action.paneId);
  }, [primaryProfileAction, showPane]);

  const removeSelected = useCallback(async () => {
    if (!selectedRow) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (ctx: PromptContext<boolean>) => (
        <ConfirmDialog
          {...ctx}
          title="Disconnect broker?"
          body={[
            `Remove "${selectedRow.label}" and imported broker data?`,
            "Broker-managed portfolios, positions, and contracts will be removed.",
          ]}
          confirmLabel="Disconnect"
          cancelLabel="Back"
          width={58}
          footer="Enter disconnect · Esc cancel"
        />
      ),
    }).catch(() => false);
    if (confirmed !== true) return;

    try {
      setBusy("Disconnecting…");
      await removeBrokerInstance(selectedRow.id);
      setEditDraft(null);
      setDetailOpen(false);
      setMessage(`Removed ${selectedRow.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to remove ${selectedRow.label}.`);
    } finally {
      setBusy(null);
    }
  }, [dialog, removeBrokerInstance, selectedRow, setDetailOpen, setEditDraft]);

  return {
    busy,
    message,
    setMessage,
    openAddBroker,
    startEdit,
    saveEdit,
    connectSelected,
    syncSelected,
    selectedProfileActions,
    primaryProfileAction,
    openProfileAction,
    removeSelected,
  };
}
