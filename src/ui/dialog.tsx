import { createContext, useContext, type ReactNode } from "react";
import { useShortcut, type KeyEventLike } from "../react/input";

export interface AlertContext {
  dialogId?: string;
  dismiss(): void;
}

export interface PromptContext<T> extends AlertContext {
  resolve(value: T): void;
}

export interface DialogApi {
  alert<T = void>(options: Record<string, unknown>): Promise<T>;
  prompt<T = string>(options: Record<string, unknown>): Promise<T>;
}

interface DialogContextValue {
  dialog: DialogApi;
  isOpen: boolean;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogHostProvider({
  dialog,
  isOpen,
  children,
}: {
  dialog: DialogApi;
  isOpen: boolean;
  children: ReactNode;
}) {
  return (
    <DialogContext value={{ dialog, isOpen }}>
      {children}
    </DialogContext>
  );
}

export function useDialog(): DialogApi {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDialog must be used inside DialogHostProvider");
  return context.dialog;
}

export function useDialogState<T>(selector: (state: { isOpen: boolean }) => T): T {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDialogState must be used inside DialogHostProvider");
  return selector({ isOpen: context.isOpen });
}

export function useDialogKeyboard(handler: (event: KeyEventLike) => void): void {
  useShortcut(handler);
}
