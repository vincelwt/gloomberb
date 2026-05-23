export interface DesktopRpcRegistry<Rpc> {
  registerWindowRpc(key: string, rpc: Rpc): void;
  unregisterWindowRpc(key: string): void;
  getWindowRpc(key: string): Rpc | undefined;
  getRpcWindowKey(rpc: Rpc): string | undefined;
  markWindowRpcReady(rpc: Rpc): void;
  isWindowRpcReady(key: string): boolean;
  forEachReadyWindowRpc(callback: (rpc: Rpc) => void): void;
}

export function createDesktopRpcRegistry<Rpc>(): DesktopRpcRegistry<Rpc> {
  const windowRpcs = new Map<string, Rpc>();
  const readyWindowRpcs = new Set<string>();
  const rpcWindowKeys = new Map<Rpc, string>();

  return {
    registerWindowRpc: (key, rpc) => {
      windowRpcs.set(key, rpc);
      rpcWindowKeys.set(rpc, key);
    },
    unregisterWindowRpc: (key) => {
      const rpc = windowRpcs.get(key);
      if (rpc) {
        rpcWindowKeys.delete(rpc);
      }
      windowRpcs.delete(key);
      readyWindowRpcs.delete(key);
    },
    getWindowRpc: (key) => windowRpcs.get(key),
    getRpcWindowKey: (rpc) => rpcWindowKeys.get(rpc),
    markWindowRpcReady: (rpc) => {
      const key = rpcWindowKeys.get(rpc);
      if (key) readyWindowRpcs.add(key);
    },
    isWindowRpcReady: (key) => readyWindowRpcs.has(key),
    forEachReadyWindowRpc: (callback) => {
      for (const key of readyWindowRpcs) {
        const rpc = windowRpcs.get(key);
        if (rpc) callback(rpc);
      }
    },
  };
}
