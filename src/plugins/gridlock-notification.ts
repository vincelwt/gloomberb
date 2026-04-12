import type { AppNotificationRequest } from "../types/plugin";

export function notifyGridlockComplete(
  notify: (notification: AppNotificationRequest) => void,
  onRevert: () => void,
): void {
  notify({
    body: "Retiled all panes",
    type: "success",
    action: {
      label: "Revert",
      onClick: onRevert,
    },
  });
}
