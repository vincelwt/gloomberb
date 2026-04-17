import type { ReactNode } from "react";
import {
  DialogProvider as OpenTuiDialogProvider,
  useDialog as useOpenTuiDialog,
  useDialogState as useOpenTuiDialogState,
} from "@opentui-ui/dialog/react";
import { DialogHostProvider } from "../../ui/dialog";

function OpenTuiDialogBridge({ children }: { children: ReactNode }) {
  const dialog = useOpenTuiDialog();
  const isOpen = useOpenTuiDialogState((state) => state.isOpen);
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
