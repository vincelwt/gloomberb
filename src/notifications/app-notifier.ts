import { spawn } from "child_process";
import type { AppNotificationRequest, AppNotificationType } from "../types/plugin";
import { debugLog } from "../utils/debug-log";

const DEFAULT_NOTIFICATION_TITLE = "Gloomberb";
const notificationLog = debugLog.createLogger("notifications");

export interface DesktopNotificationCommand {
  command: string;
  args: string[];
}

export interface DesktopNotificationRunner {
  run(
    command: string,
    args: string[],
    handlers?: { onError?: (error: NodeJS.ErrnoException) => void },
  ): void;
}

export interface DesktopNotificationSink {
  notify(notification: AppNotificationRequest): void;
}

export interface AppNotifier {
  notify(notification: AppNotificationRequest): void;
}

interface CreateAppNotifierOptions {
  isAppActive: () => boolean;
  renderToast: (notification: AppNotificationRequest) => void;
  desktop?: DesktopNotificationSink | null;
}

function escapeAppleScriptString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")}"`;
}

function escapePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function mapLinuxUrgency(type: AppNotificationType | undefined): "low" | "normal" | "critical" {
  if (type === "error") return "critical";
  if (type === "success") return "low";
  return "normal";
}

function mapWindowsIcon(type: AppNotificationType | undefined): string {
  if (type === "error") return "Error";
  if (type === "success") return "Information";
  return "Information";
}

function buildLinuxBody(notification: AppNotificationRequest): string | undefined {
  const parts = [notification.subtitle?.trim(), notification.body.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildWindowsBody(notification: AppNotificationRequest): string {
  const parts = [notification.subtitle?.trim(), notification.body.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : notification.body.trim();
}

export function buildDesktopNotificationCommand(
  notification: AppNotificationRequest,
  platform: NodeJS.Platform = process.platform,
): DesktopNotificationCommand | null {
  const title = notification.title?.trim() || DEFAULT_NOTIFICATION_TITLE;
  const body = notification.body.trim();
  const subtitle = notification.subtitle?.trim();

  if (!body) {
    return null;
  }

  if (platform === "darwin") {
    const script = [
      `display notification ${escapeAppleScriptString(body)} with title ${escapeAppleScriptString(title)}`,
      subtitle ? `subtitle ${escapeAppleScriptString(subtitle)}` : "",
    ].filter(Boolean).join(" ");
    return {
      command: "osascript",
      args: ["-e", script],
    };
  }

  if (platform === "linux") {
    const linuxBody = buildLinuxBody(notification);
    return {
      command: "notify-send",
      args: [
        "--app-name",
        DEFAULT_NOTIFICATION_TITLE,
        "--urgency",
        mapLinuxUrgency(notification.type),
        title,
        ...(linuxBody ? [linuxBody] : []),
      ],
    };
  }

  if (platform === "win32") {
    const balloonBody = buildWindowsBody(notification);
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$notify = New-Object System.Windows.Forms.NotifyIcon;",
      `$notify.Icon = [System.Drawing.SystemIcons]::${mapWindowsIcon(notification.type)};`,
      `$notify.BalloonTipTitle = ${escapePowerShellString(title)};`,
      `$notify.BalloonTipText = ${escapePowerShellString(balloonBody)};`,
      "$notify.Visible = $true;",
      "$notify.ShowBalloonTip(5000);",
      "Start-Sleep -Seconds 6;",
      "$notify.Dispose();",
    ].join(" ");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    };
  }

  return null;
}

function defaultDesktopNotificationRunner(
  command: string,
  args: string[],
  handlers?: { onError?: (error: NodeJS.ErrnoException) => void },
): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    handlers?.onError?.(error);
  });
  child.unref();
}

export function createDesktopNotifier(
  options: {
    platform?: NodeJS.Platform;
    runner?: DesktopNotificationRunner;
  } = {},
): DesktopNotificationSink {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? { run: defaultDesktopNotificationRunner };
  let disabledCommand: string | null = null;

  return {
    notify(notification) {
      const desktopCommand = buildDesktopNotificationCommand(notification, platform);
      if (!desktopCommand) {
        return;
      }

      if (disabledCommand === desktopCommand.command) {
        return;
      }

      runner.run(desktopCommand.command, desktopCommand.args, {
        onError: (error) => {
          if (error.code === "ENOENT") {
            disabledCommand = desktopCommand.command;
          }
          notificationLog.warn("desktop notification failed", {
            command: desktopCommand.command,
            code: error.code,
            message: error.message,
          });
        },
      });
    },
  };
}

export function createAppNotifier({
  isAppActive,
  renderToast,
  desktop = createDesktopNotifier(),
}: CreateAppNotifierOptions): AppNotifier {
  return {
    notify(notification) {
      const toastEnabled = notification.toast !== false;
      const desktopMode = notification.desktop ?? "never";

      if (toastEnabled) {
        renderToast(notification);
      }

      if (
        desktopMode === "always" ||
        (desktopMode === "when-inactive" && !isAppActive())
      ) {
        desktop?.notify(notification);
      }
    },
  };
}
