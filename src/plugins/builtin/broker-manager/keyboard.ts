import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { BrokerEditKey } from "./detail";

export function useBrokerManagerKeyboard({
  activeEditKey,
  canOpenSelectedAction,
  canRemoveSelected,
  canUseSelectedBroker,
  connectSelected,
  detailOpen,
  editing,
  editKeys,
  focused,
  hasSelectedRow,
  onActiveEditKeyChange,
  onCancelEdit,
  onOpenDetail,
  openAddBroker,
  openProfileAction,
  removeSelected,
  saveEdit,
  startEdit,
  syncSelected,
}: {
  activeEditKey: BrokerEditKey;
  canOpenSelectedAction: boolean;
  canRemoveSelected: boolean;
  canUseSelectedBroker: boolean;
  connectSelected: () => Promise<void>;
  detailOpen: boolean;
  editing: boolean;
  editKeys: BrokerEditKey[];
  focused: boolean;
  hasSelectedRow: boolean;
  onActiveEditKeyChange: (key: BrokerEditKey) => void;
  onCancelEdit: () => void;
  onOpenDetail: () => void;
  openAddBroker: () => void;
  openProfileAction: () => void;
  removeSelected: () => Promise<void>;
  saveEdit: () => Promise<void>;
  startEdit: () => void;
  syncSelected: () => Promise<void>;
}) {
  useShortcut((event) => {
    if (!focused) return;

    if (editing) {
      if (event.name === "escape") {
        event.stopPropagation();
        onCancelEdit();
        return;
      }
      if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        saveEdit().catch(() => {});
        return;
      }
      if (isPlainKey(event, "up", "k")) {
        event.stopPropagation();
        const index = editKeys.indexOf(activeEditKey);
        onActiveEditKeyChange(editKeys[Math.max(0, index - 1)] ?? "label");
        return;
      }
      if (isPlainKey(event, "down", "j", "tab")) {
        event.stopPropagation();
        const index = editKeys.indexOf(activeEditKey);
        onActiveEditKeyChange(editKeys[Math.min(editKeys.length - 1, index + 1)] ?? "label");
        return;
      }
      return;
    }

    switch (event.name) {
      case "a":
        openAddBroker();
        break;
      case "enter":
      case "return":
        if (!detailOpen && hasSelectedRow) {
          event.stopPropagation();
          event.preventDefault?.();
          onOpenDetail();
        }
        break;
      case "e":
        if (canUseSelectedBroker) startEdit();
        break;
      case "c":
        if (canUseSelectedBroker) connectSelected().catch(() => {});
        break;
      case "s":
        if (canUseSelectedBroker) syncSelected().catch(() => {});
        break;
      case "o":
        if (canOpenSelectedAction) openProfileAction();
        break;
      case "d":
        if (canRemoveSelected) removeSelected().catch(() => {});
        break;
    }
  });
}
