import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { AccountDraft, AccountFieldKey } from "./model";

export function useAccountManagementKeyboard({
  activeField,
  cycleField,
  cyclePortfolio,
  draftRef,
  focused,
  openPasswordDialog,
  openPortfolioDialog,
  openUpgrade,
  saveProfile,
  setDraftValue,
  deleteAccount,
  turnOffEmailAlerts,
}: {
  activeField: AccountFieldKey;
  cycleField: (delta: number) => void;
  cyclePortfolio: (delta: number) => void;
  draftRef: { current: AccountDraft };
  focused: boolean;
  openPasswordDialog: () => void;
  openPortfolioDialog: () => Promise<void>;
  openUpgrade: () => void;
  saveProfile: () => Promise<void>;
  setDraftValue: <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => void;
  deleteAccount: () => Promise<void>;
  turnOffEmailAlerts: () => Promise<void>;
}) {
  useShortcut((event) => {
    if (!focused) return;

    if (event.ctrl && event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      void saveProfile();
      return;
    }

    if (isPlainKey(event, "tab") || (!event.targetEditable && isPlainKey(event, "down", "j"))) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleField(1);
      return;
    }
    if (!event.targetEditable && isPlainKey(event, "up", "k")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cycleField(-1);
      return;
    }
    if (!event.targetEditable && activeField === "profilePublic" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("profilePublic", !draftRef.current.profilePublic);
      return;
    }
    if (!event.targetEditable && activeField === "acceptUnknownDms" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("acceptUnknownDms", !draftRef.current.acceptUnknownDms);
      return;
    }
    if (!event.targetEditable && activeField === "weeklyRoundupEnabled" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("weeklyRoundupEnabled", !draftRef.current.weeklyRoundupEnabled);
      return;
    }
    if (!event.targetEditable && activeField === "positionAlertsEnabled" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDraftValue("positionAlertsEnabled", !draftRef.current.positionAlertsEnabled);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "left", "h", "[")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cyclePortfolio(-1);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "right", "l", "]")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      cyclePortfolio(1);
      return;
    }
    if (!event.targetEditable && activeField === "sharedPortfolioId" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void openPortfolioDialog();
      return;
    }
    if (!event.targetEditable && activeField === "passwordAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openPasswordDialog();
      return;
    }
    if (!event.targetEditable && activeField === "upgradeAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openUpgrade();
      return;
    }
    if (!event.targetEditable && activeField === "deleteAccountAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void deleteAccount();
      return;
    }
    if (!event.targetEditable && activeField === "emailAlertsOffAction" && isPlainKey(event, "space", "enter", "return")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void turnOffEmailAlerts();
    }
  }, { allowEditable: true });
}
