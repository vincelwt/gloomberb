/// <reference lib="dom" />
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogHostProvider, type DialogApi } from "../../../ui/dialog";
import { blendHex, colors } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";

interface DialogState {
  id: string;
  content: ReactNode | ((context: { dialogId: string; dismiss(): void; resolve(value: unknown): void }) => ReactNode);
  closeOnClickOutside: boolean;
  returnFocus: HTMLElement | null;
  resolve(value: unknown): void;
}

let nextDialogId = 1;

export function WebDialogHostProvider({ children }: { children: ReactNode }) {
  useThemeColors();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const dialogStateRef = useRef<DialogState | null>(null);
  const dialogElementRef = useRef<HTMLDivElement | null>(null);
  const dialogBorder = blendHex(colors.border, colors.borderFocused, 0.18);
  const dialogBg = blendHex(colors.panel, colors.bg, 0.12);

  const close = useCallback((value?: unknown) => {
    const current = dialogStateRef.current;
    if (!current) return;
    dialogStateRef.current = null;
    setDialogState(null);
    current.resolve(value);
    queueMicrotask(() => {
      if (current.returnFocus?.isConnected) {
        current.returnFocus.focus({ preventScroll: true });
      }
    });
  }, []);

  const open = useCallback(function openDialog<T>(options: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve) => {
      const activeElement = document.activeElement;
      const next: DialogState = {
        id: `web-dialog-${nextDialogId++}`,
        content: options.content as DialogState["content"],
        closeOnClickOutside: options.closeOnClickOutside === true,
        returnFocus: activeElement instanceof HTMLElement ? activeElement : null,
        resolve: (value) => resolve(value as T),
      };
      dialogStateRef.current?.resolve(undefined);
      dialogStateRef.current = next;
      setDialogState(next);
    });
  }, []);

  useEffect(() => {
    if (!dialogState) return;
    const frame = requestAnimationFrame(() => dialogElementRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [dialogState?.id]);

  const api = useMemo<DialogApi>(() => ({
    alert: open,
    prompt: open,
  }), [open]);

  return (
    <DialogHostProvider dialog={api} isOpen={dialogState !== null}>
      {children}
      {dialogState && (
        <div
          className="gloom-dialog-backdrop"
          onMouseDown={(event) => {
            if (
              dialogState.closeOnClickOutside
              && event.target === event.currentTarget
            ) {
              close(undefined);
            }
          }}
        >
          <div
            ref={dialogElementRef}
            role="dialog"
            aria-modal="true"
            aria-label="Dialog"
            tabIndex={-1}
            className="gloom-dialog"
            style={{
              borderColor: dialogBorder,
              background: dialogBg,
              color: colors.text,
            }}
          >
            {typeof dialogState.content === "function"
              ? dialogState.content({
                dialogId: dialogState.id,
                dismiss: () => close(undefined),
                resolve: close,
              })
              : dialogState.content}
          </div>
        </div>
      )}
    </DialogHostProvider>
  );
}
