import type { DesktopDeepLinkBridge } from "../../../types/desktop-deeplink";
import { onDesktopDeepLink } from "./backend-rpc";

export function createDesktopDeepLinkBridge(): DesktopDeepLinkBridge {
  return {
    subscribe(listener) {
      return onDesktopDeepLink(listener);
    },
  };
}
