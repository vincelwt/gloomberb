/// <reference lib="dom" />
/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { InputHostProvider, type InputHost, type KeyEventLike, type ShortcutOptions } from "../../../react/input";
import { hasWebCtrlModifier, normalizeWebKeyName, shouldConsumeWebAppKeyDown, webKeySequence } from "./key-event";

export const WEB_CELL_WIDTH = 8;
export const WEB_CELL_HEIGHT = 18;

function toKeyEventLike(event: KeyboardEvent): KeyEventLike {
  const key = normalizeWebKeyName(event.key);
  let propagationStopped = false;
  return {
    key,
    name: key,
    sequence: webKeySequence(event),
    ctrl: hasWebCtrlModifier(event),
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    super: event.metaKey,
    get defaultPrevented() {
      return event.defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    },
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => {
      propagationStopped = true;
      event.stopPropagation();
    },
  };
}

interface ShortcutEntry {
  handlerRef: { current: (event: KeyEventLike) => void };
  enabledRef: { current: boolean };
  phase: NonNullable<ShortcutOptions["phase"]>;
  order: number;
}

let nextShortcutOrder = 1;

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
  const shortcutsRef = useRef<ShortcutEntry[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcutEvent = toKeyEventLike(event);
      for (const phase of ["normal", "after"] as const) {
        if (phase === "after" && (shortcutEvent.defaultPrevented || shortcutEvent.propagationStopped)) break;
        for (const entry of shortcutsRef.current) {
          if (entry.phase !== phase || !entry.enabledRef.current) continue;
          entry.handlerRef.current(shortcutEvent);
          if (shortcutEvent.propagationStopped) break;
        }
        if (shortcutEvent.propagationStopped) break;
      }
      if (shouldConsumeWebAppKeyDown(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const host = useMemo<InputHost>(() => ({
    useShortcut(handler, options) {
      const handlerRef = useRef(handler);
      const enabledRef = useRef(options?.enabled !== false);
      handlerRef.current = handler;
      enabledRef.current = options?.enabled !== false;

      useLayoutEffect(() => {
        const entry: ShortcutEntry = {
          handlerRef,
          enabledRef,
          phase: options?.phase ?? "normal",
          order: nextShortcutOrder++,
        };
        shortcutsRef.current = [...shortcutsRef.current, entry].sort((a, b) => a.order - b.order);
        return () => {
          shortcutsRef.current = shortcutsRef.current.filter((current) => current !== entry);
        };
      }, [options?.phase, options?.scope]);
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
