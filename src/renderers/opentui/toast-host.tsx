import { Toaster, toast } from "@opentui-ui/toast/react";
import type { ToastHost } from "../../ui/toast";

export const openTuiToastHost: ToastHost = {
  Viewport: Toaster as ToastHost["Viewport"],
  success: toast.success,
  error: toast.error,
  info: toast.info,
  dismiss: toast.dismiss,
};
