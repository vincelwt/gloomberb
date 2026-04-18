/// <reference lib="dom" />
/** @jsxImportSource react */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { InputHostProvider, type InputHost, type KeyEventLike } from "../../../react/input";
import { hasWebCtrlModifier, normalizeWebKeyName, shouldConsumeWebAppKeyDown, webKeySequence } from "./key-event";

export const WEB_CELL_WIDTH = 8;
export const WEB_CELL_HEIGHT = 18;

function toKeyEventLike(event: KeyboardEvent): KeyEventLike {
  const key = normalizeWebKeyName(event.key);
  return {
    key,
    name: key,
    sequence: webKeySequence(event),
    ctrl: hasWebCtrlModifier(event),
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    super: event.metaKey,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  };
}

function subscribeViewport(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

let viewportSnapshot = { width: 0, height: 0 };

function getViewport() {
  const width = Math.max(1, window.innerWidth / WEB_CELL_WIDTH);
  const height = Math.max(1, window.innerHeight / WEB_CELL_HEIGHT);
  if (viewportSnapshot.width !== width || viewportSnapshot.height !== height) {
    viewportSnapshot = { width, height };
  }
  return viewportSnapshot;
}

export function WebInputHostProvider({ children }: { children: ReactNode }) {
  const host = useMemo<InputHost>(() => ({
    useShortcut(handler, options) {
      useEffect(() => {
        if (options?.enabled === false) return;
        const onKeyDown = (event: KeyboardEvent) => {
          handler(toKeyEventLike(event));
          if (shouldConsumeWebAppKeyDown(event)) event.preventDefault();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [handler, options?.enabled, options?.scope]);
    },
    useViewport() {
      return useSyncExternalStore(subscribeViewport, getViewport, getViewport);
    },
  }), []);

  return (
    <InputHostProvider host={host}>
      {children}
    </InputHostProvider>
  );
}
