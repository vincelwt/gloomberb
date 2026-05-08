import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  DialogProvider as OpenTuiDialogProvider,
  useDialog as useOpenTuiDialog,
  useDialogState as useOpenTuiDialogState,
} from "@opentui-ui/dialog/react";
import { DialogHostProvider, type DialogApi } from "../../ui/dialog";

function renderDialogContent(content: unknown, context: Record<string, unknown>): ReactNode {
  return typeof content === "function"
    ? (content as (context: Record<string, unknown>) => ReactNode)(context)
    : content as ReactNode;
}

function OpenTuiDialogBridge({ children }: { children: ReactNode }) {
  const openTuiDialog = useOpenTuiDialog();
  const isOpen = useOpenTuiDialogState((state) => state.isOpen);
  const dialog = useMemo<DialogApi>(() => {
    const wrapOptions = (options: Record<string, unknown>) => ({
      ...options,
      content: (context: Record<string, unknown>) => (
        <DialogHostProvider dialog={dialog} isOpen={true}>
          {renderDialogContent(options.content, context)}
        </DialogHostProvider>
      ),
    });

    return {
      alert: (options) => openTuiDialog.alert(wrapOptions(options)),
      prompt: (options) => openTuiDialog.prompt(wrapOptions(options)),
    };
  }, [openTuiDialog]);

  return (
    <DialogHostProvider dialog={dialog} isOpen={isOpen}>
      {children}
    </DialogHostProvider>
  );
}

export function OpenTuiDialogHostProvider({
  children,
  ...props
}: {
  children: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <OpenTuiDialogProvider {...props}>
      <OpenTuiDialogBridge>
        {children}
      </OpenTuiDialogBridge>
    </OpenTuiDialogProvider>
  );
}
