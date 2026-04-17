import { createContext, createElement, useContext, type ReactNode } from "react";

export interface KeyEventLike {
  key: string;
  name?: string;
  sequence?: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  super?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface InputHost {
  useShortcut(
    handler: (event: KeyEventLike) => void,
    options?: { enabled?: boolean; scope?: string },
  ): void;
  useViewport(): { width: number; height: number };
}

const InputHostContext = createContext<InputHost | null>(null);

export function InputHostProvider({
  host,
  children,
}: {
  host: InputHost;
  children: ReactNode;
}) {
  return createElement(InputHostContext, { value: host }, children);
}

function useInputHost(): InputHost {
  const host = useContext(InputHostContext);
  if (!host) {
    throw new Error("Input host hooks must be used inside InputHostProvider");
  }
  return host;
}

export function useShortcut(
  handler: (event: KeyEventLike) => void,
  options?: { enabled?: boolean; scope?: string },
): void {
  useInputHost().useShortcut(handler, options);
}

export function useViewport(): { width: number; height: number } {
  return useInputHost().useViewport();
}
