/// <reference lib="dom" />
/** @jsxImportSource react */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DialogHostProvider, type DialogApi } from "../../../ui/dialog";

interface DialogState {
  id: string;
  content: ReactNode | ((context: { dialogId: string; dismiss(): void; resolve(value: unknown): void }) => ReactNode);
  resolve(value: unknown): void;
}

let nextDialogId = 1;

export function WebDialogHostProvider({ children }: { children: ReactNode }) {
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const close = useCallback((value?: unknown) => {
    setDialogState((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const open = useCallback((options: Record<string, unknown>) => (
    new Promise<unknown>((resolve) => {
      setDialogState({
        id: `web-dialog-${nextDialogId++}`,
        content: options.content as DialogState["content"],
        resolve,
      });
    })
  ), []);

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
            if (event.target === event.currentTarget) close(undefined);
          }}
        >
          <div className="gloom-dialog">
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
