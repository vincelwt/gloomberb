import { useEffect } from "react";
import type { PluginRegistry } from "../../plugins/registry";
import type { DesktopDeepLinkBridge } from "../../types/desktop-deeplink";
import type { DesktopWindowBridge } from "../../types/desktop-window";

type CloudDeepLinkRoute = {
  kind: "cloud-alerts" | "cloud-roundup";
  week: string | null;
};

export type DesktopDeepLinkAction =
  | { type: "open-account-management"; route: CloudDeepLinkRoute; message: string }
  | { type: "unsupported"; message: string };

function weekSuffix(week: string | null): string {
  return week ? ` for ${week}` : "";
}

export function resolveDesktopDeepLinkAction(rawUrl: string): DesktopDeepLinkAction {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { type: "unsupported", message: "Unsupported Gloomberb link." };
  }

  if (url.protocol !== "gloomberb:" || url.hostname !== "cloud") {
    return { type: "unsupported", message: "Unsupported Gloomberb link." };
  }

  const route = url.pathname.replace(/^\/+/, "");
  const week = url.searchParams.get("week");
  if (route === "roundup") {
    return {
      type: "open-account-management",
      route: { kind: "cloud-roundup", week },
      message: `Opened weekly roundup settings${weekSuffix(week)}.`,
    };
  }
  if (route === "alerts") {
    return {
      type: "open-account-management",
      route: { kind: "cloud-alerts", week },
      message: `Opened portfolio alert settings${weekSuffix(week)}.`,
    };
  }

  return { type: "unsupported", message: "Unsupported Gloomberb cloud link." };
}

export function handleDesktopDeepLink(rawUrl: string, pluginRegistry: PluginRegistry): void {
  const action = resolveDesktopDeepLinkAction(rawUrl);
  if (action.type === "unsupported") {
    pluginRegistry.notify({ body: action.message, type: "error" });
    return;
  }
  if (!pluginRegistry.panes.has("account-management")) {
    pluginRegistry.notify({ body: "Account management is unavailable.", type: "error" });
    return;
  }
  pluginRegistry.showPane("account-management");
  pluginRegistry.notify({ body: action.message, type: "success" });
}

export function useDesktopDeepLinkRuntime({
  desktopDeepLinkBridge,
  desktopWindowKind,
  pluginRegistry,
}: {
  desktopDeepLinkBridge?: DesktopDeepLinkBridge;
  desktopWindowKind?: DesktopWindowBridge["kind"];
  pluginRegistry: PluginRegistry;
}) {
  useEffect(() => {
    if (desktopWindowKind !== "main" || !desktopDeepLinkBridge) return;
    return desktopDeepLinkBridge.subscribe((deeplink) => {
      handleDesktopDeepLink(deeplink.url, pluginRegistry);
    });
  }, [desktopDeepLinkBridge, desktopWindowKind, pluginRegistry]);
}
