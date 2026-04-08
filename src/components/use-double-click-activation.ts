import { useCallback, useRef } from "react";

interface LastClickState {
  targetKey: string;
}

export function useDoubleClickActivation<T>({
  onSelect,
  onActivate,
}: {
  onSelect?: (value: T) => void;
  onActivate?: (value: T) => void;
}) {
  const lastClickRef = useRef<LastClickState | null>(null);

  return useCallback((targetKey: string, value: T) => {
    const lastClick = lastClickRef.current;

    onSelect?.(value);

    if (lastClick && lastClick.targetKey === targetKey) {
      lastClickRef.current = null;
      onActivate?.(value);
      return;
    }

    lastClickRef.current = {
      targetKey,
    };
  }, [onActivate, onSelect]);
}
