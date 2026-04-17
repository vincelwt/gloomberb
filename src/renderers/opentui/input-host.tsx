import { useMemo, type ReactNode } from "react";
import { InputHostProvider, type InputHost } from "../../react/input";
import { toKeyEventLike, useKeyboard, useTerminalDimensions } from "./host";

export function OpenTuiInputHostProvider({ children }: { children: ReactNode }) {
  const host = useMemo<InputHost>(() => ({
    useShortcut(handler, options) {
      useKeyboard((event) => {
        if (options?.enabled === false) return;
        handler(toKeyEventLike(event));
      });
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
