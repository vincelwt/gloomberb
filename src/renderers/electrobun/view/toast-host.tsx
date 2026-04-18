/// <reference lib="dom" />
/** @jsxImportSource react */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ToastHostProvider, type ToastHost, type ToastOptions } from "../../../ui/toast";

interface ToastEntry {
  id: number;
  body: string;
  type: "info" | "success" | "error";
  action?: ToastOptions["action"];
}

let nextToastId = 1;

export function WebToastHostProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string | number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((type: ToastEntry["type"], body: string, options?: ToastOptions) => {
    const id = nextToastId++;
    setToasts((current) => [...current, { id, type, body, action: options?.action }].slice(-6));
    if (options?.duration !== 0) {
      setTimeout(() => dismiss(id), options?.duration ?? 4500);
    }
    return id;
  }, [dismiss]);

  const host = useMemo<ToastHost>(() => ({
    Viewport() {
      return (
        <div className="gloom-toast-viewport">
          {toasts.map((toast) => (
            <div key={toast.id} className={`gloom-toast gloom-toast-${toast.type}`}>
              <div>{toast.body}</div>
              {toast.action && (
                <button
                  className="gloom-toast-action"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      );
    },
    success: (body, options) => push("success", body, options),
    error: (body, options) => push("error", body, options),
    info: (body, options) => push("info", body, options),
    dismiss,
  }), [dismiss, push, toasts]);

  return (
    <ToastHostProvider host={host}>
      {children}
    </ToastHostProvider>
  );
}
