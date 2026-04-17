/// <reference lib="dom" />
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../../../types/config";
import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import { decodeRpcValue, encodeRpcValue } from "./rpc-codec";

export interface TauriBackendInit {
  config: AppConfig;
  sessionSnapshot: AppSessionSnapshot | null;
  pluginState: Record<string, Record<string, unknown>>;
}

let initSnapshot: TauriBackendInit | null = null;

export async function backendRequest<T = unknown>(method: string, payload: unknown = null): Promise<T> {
  const result = await invoke<unknown>("tauri_backend_request", {
    request: {
      method,
      payload: encodeRpcValue(payload),
    },
  });
  return decodeRpcValue<T>(result);
}

export async function initTauriBackend(): Promise<TauriBackendInit> {
  initSnapshot = await backendRequest<TauriBackendInit>("init");
  return initSnapshot;
}

export function getTauriBackendInitSnapshot(): TauriBackendInit | null {
  return initSnapshot;
}
