import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { InputHostProvider, type InputHost, type KeyEventLike, type ShortcutOptions } from "../../react/input";
import { toKeyEventLike, useKeyboard, useTerminalDimensions } from "./host";

interface ShortcutEntry {
  handlerRef: { current: (event: KeyEventLike) => void };
  enabledRef: { current: boolean };
  phase: NonNullable<ShortcutOptions["phase"]>;
  order: number;
}

let nextShortcutOrder = 1;

export function OpenTuiInputHostProvider({ children }: { children: ReactNode }) {
  const shortcutsRef = useRef<ShortcutEntry[]>([]);
  const dispatchShortcut = (event: KeyEventLike) => {
    const shortcuts = shortcutsRef.current;
    for (const phase of ["before", "normal", "after"] as const) {
      if (phase === "after" && (event.defaultPrevented || event.propagationStopped)) return;
      for (const entry of shortcuts) {
        if (entry.phase !== phase || !entry.enabledRef.current) continue;
        entry.handlerRef.current(event);
        if (event.propagationStopped) return;
      }
    }
  };

  useKeyboard((event) => {
    dispatchShortcut(toKeyEventLike(event));
  });

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
      const dimensions = useTerminalDimensions();
      return { width: dimensions.width, height: dimensions.height };
    },
  }), []);

  return (
    <InputHostProvider host={host}>
      {children}
    </InputHostProvider>
  );
}
