import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { resetTerminalInputState } from "../../utils/terminal-input-reset";
import type { KeyEventLike } from "../../react/input";
import type { NativeRendererHost, RendererHost } from "../../ui/host";

export { useKeyboard, useRenderer, useTerminalDimensions };
export type { CliRenderer };

export interface OpenTuiHost {
  renderer: CliRenderer;
  rendererHost: RendererHost;
  nativeRenderer: NativeRendererHost;
  render(node: ReactNode): void;
  destroy(): void;
}

export function toKeyEventLike(event: {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  sequence?: string;
  key?: string;
  super?: boolean;
}): KeyEventLike {
  const key = event.name ?? event.key ?? "";
  return {
    key,
    name: key,
    sequence: event.sequence,
    ctrl: event.ctrl ?? false,
    shift: event.shift ?? false,
    alt: event.alt ?? false,
    meta: event.meta ?? event.super ?? false,
    super: event.super ?? event.meta ?? false,
    preventDefault: () => event.preventDefault?.(),
    stopPropagation: () => event.stopPropagation?.(),
  };
}

export async function createOpenTuiHost(): Promise<OpenTuiHost> {
  resetTerminalInputState();

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: "#000000",
    enableMouseMovement: true,
  });
  const root = createRoot(renderer);

  const rendererHost: RendererHost = {
    requestExit: () => renderer.destroy(),
    async openExternal(url) {
      const command = process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
      const proc = Bun.spawn(command, {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    },
    async copyText(text) {
      const proc = Bun.spawn(["pbcopy"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
    },
    async readText() {
      const proc = Bun.spawn(["pbpaste"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      return await new Response(proc.stdout).text();
    },
    notify() {
      // The app-level notifier still owns toast/desktop notification behavior.
    },
  };

  const nativeRenderer: NativeRendererHost = {
    get terminalWidth() {
      return renderer.terminalWidth;
    },
    get terminalHeight() {
      return renderer.terminalHeight;
    },
    get resolution() {
      return renderer.resolution ?? null;
    },
    get capabilities() {
      return renderer.capabilities;
    },
    get isDestroyed() {
      return renderer.isDestroyed;
    },
    get keyInput() {
      return renderer.keyInput;
    },
    on: (event, handler) => renderer.on(event, handler),
    off: (event, handler) => renderer.off(event, handler),
    requestRender: () => renderer.requestRender(),
    registerLifecyclePass: (renderable) => renderer.registerLifecyclePass(renderable as any),
    unregisterLifecyclePass: (renderable) => renderer.unregisterLifecyclePass(renderable as any),
    getSelection: () => renderer.getSelection(),
    copyToClipboardOSC52: (text) => renderer.copyToClipboardOSC52(text),
    write(data) {
      if (renderer.isDestroyed) return false;
      const writer = (renderer as unknown as { writeOut?: (payload: string | Uint8Array) => void }).writeOut;
      if (typeof writer !== "function") return false;
      writer.call(renderer, data);
      return true;
    },
  };

  return {
    renderer,
    rendererHost,
    nativeRenderer,
    render: (node) => root.render(node),
    destroy: () => renderer.destroy(),
  };
}
