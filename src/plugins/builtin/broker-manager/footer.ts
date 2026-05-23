import { useMemo, useRef } from "react";
import { usePaneFooter, type PaneHint } from "../../../components";

interface BrokerManagerFooterActions {
  connectSelected: () => Promise<void>;
  openAddBroker: () => void;
  openProfileAction: () => void;
  removeSelected: () => Promise<void>;
  saveEdit: () => Promise<void>;
  startEdit: () => void;
  syncSelected: () => Promise<void>;
}

export function useBrokerManagerFooter({
  actions,
  canOpenSelectedAction,
  canRemoveSelected,
  canUseSelectedBroker,
  editing,
  onCancelEdit,
}: {
  actions: BrokerManagerFooterActions;
  canOpenSelectedAction: boolean;
  canRemoveSelected: boolean;
  canUseSelectedBroker: boolean;
  editing: boolean;
  onCancelEdit: () => void;
}) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const footerHints = useMemo<PaneHint[]>(() => {
    if (editing) {
      return [
        { id: "save", key: "enter", label: "save", onPress: () => actionsRef.current.saveEdit().catch(() => {}) },
        { id: "cancel", key: "esc", label: "cancel", onPress: onCancelEdit },
      ];
    }

    const hints: PaneHint[] = [
      { id: "add", key: "a", label: "dd", onPress: () => actionsRef.current.openAddBroker() },
    ];
    if (canUseSelectedBroker) {
      hints.push(
        { id: "edit", key: "e", label: "dit", onPress: () => actionsRef.current.startEdit() },
        { id: "connect", key: "c", label: "onnect", onPress: () => actionsRef.current.connectSelected().catch(() => {}) },
        { id: "sync", key: "s", label: "ync", onPress: () => actionsRef.current.syncSelected().catch(() => {}) },
      );
    }
    if (canOpenSelectedAction) {
      hints.push({ id: "open", key: "o", label: "pen", onPress: () => actionsRef.current.openProfileAction() });
    }
    if (canRemoveSelected) {
      hints.push({ id: "disconnect", key: "d", label: "isconnect", onPress: () => actionsRef.current.removeSelected().catch(() => {}) });
    }
    return hints;
  }, [canOpenSelectedAction, canRemoveSelected, canUseSelectedBroker, editing, onCancelEdit]);

  usePaneFooter("broker-manager", () => ({
    hints: footerHints,
  }), [footerHints]);
}
