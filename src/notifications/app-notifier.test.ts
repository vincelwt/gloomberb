import { describe, expect, test } from "bun:test";
import {
  buildDesktopNotificationCommand,
  createAppNotifier,
  createDesktopNotifier,
} from "./app-notifier";

describe("desktop notification commands", () => {
  test("builds a macOS notification command", () => {
    const command = buildDesktopNotificationCommand({
      title: "Chat mention",
      body: "@bob mentioned you",
      subtitle: "#everyone",
    }, "darwin");

    expect(command).toEqual({
      command: "osascript",
      args: ["-e", "display notification \"@bob mentioned you\" with title \"Chat mention\" subtitle \"#everyone\""],
    });
  });

  test("builds a Linux notification command", () => {
    const command = buildDesktopNotificationCommand({
      title: "Chat mention",
      body: "@bob mentioned you",
      subtitle: "#everyone",
      type: "error",
    }, "linux");

    expect(command).toEqual({
      command: "notify-send",
      args: ["--app-name", "Gloomberb", "--urgency", "critical", "Chat mention", "#everyone\n@bob mentioned you"],
    });
  });

  test("builds a Windows notification command", () => {
    const command = buildDesktopNotificationCommand({
      title: "Chat mention",
      body: "@bob mentioned you",
      subtitle: "#everyone",
    }, "win32");

    expect(command?.command).toBe("powershell.exe");
    expect(command?.args[0]).toBe("-NoProfile");
    expect(command?.args.at(-1)).toContain("$notify.BalloonTipTitle = 'Chat mention';");
    expect(command?.args.at(-1)).toContain("$notify.BalloonTipText = '#everyone\n@bob mentioned you';");
  });
});

describe("app notifier", () => {
  test("shows a toast and sends a desktop notification when inactive", () => {
    const toasts: Array<{ message: string; type?: string; duration?: number }> = [];
    const desktops: string[] = [];
    let active = false;
    const notifier = createAppNotifier({
      isAppActive: () => active,
      renderToast: (notification) => {
        toasts.push({
          message: notification.body,
          type: notification.type,
          duration: notification.duration,
        });
      },
      desktop: {
        notify(notification) {
          desktops.push(notification.body);
        },
      },
    });

    notifier.notify({
      title: "Chat mention",
      body: "@bob mentioned you",
      type: "info",
      desktop: "when-inactive",
      duration: 5000,
    });

    expect(toasts).toEqual([{ message: "@bob mentioned you", type: "info", duration: 5000 }]);
    expect(desktops).toEqual(["@bob mentioned you"]);

    active = true;
    notifier.notify({
      body: "Visible toast only",
      type: "success",
      desktop: "when-inactive",
    });

    expect(toasts).toEqual([
      { message: "@bob mentioned you", type: "info", duration: 5000 },
      { message: "Visible toast only", type: "success", duration: undefined },
    ]);
    expect(desktops).toEqual(["@bob mentioned you"]);
  });

  test("toast-disabled notifications skip toast delivery", () => {
    const toasts: string[] = [];
    const desktops: string[] = [];
    const notifier = createAppNotifier({
      isAppActive: () => false,
      renderToast: (notification) => {
        toasts.push(notification.body);
      },
      desktop: {
        notify(notification) {
          desktops.push(notification.body);
        },
      },
    });

    notifier.notify({ body: "Saved", type: "success", toast: false, desktop: "when-inactive" });

    expect(toasts).toEqual([]);
    expect(desktops).toEqual(["Saved"]);
  });
});

describe("desktop notifier", () => {
  test("stops retrying a missing desktop notification command", () => {
    const calls: string[] = [];
    const notifier = createDesktopNotifier({
      platform: "linux",
      runner: {
        run(command, _args, handlers) {
          calls.push(command);
          handlers?.onError?.(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
      },
    });

    notifier.notify({ body: "first" });
    notifier.notify({ body: "second" });

    expect(calls).toEqual(["notify-send"]);
  });
});
