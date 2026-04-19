import type { DesktopApplicationMenuBridge } from "../../../types/desktop-menu";
import { onApplicationMenuSelect } from "./backend-rpc";

export function createApplicationMenuBridge(): DesktopApplicationMenuBridge {
  return {
    subscribe(listener) {
      return onApplicationMenuSelect((message) => {
        listener(message.command);
      });
    },
  };
}
