export type AccountManagementTab = "profile" | "emails" | "pro" | "advanced";

let pendingTab: AccountManagementTab | null = null;
const listeners = new Set<(tab: AccountManagementTab) => void>();

export function requestAccountManagementTab(tab: AccountManagementTab): void {
  pendingTab = tab;
  if (listeners.size === 0) return;
  for (const listener of listeners) listener(tab);
  pendingTab = null;
}

export function consumeRequestedAccountManagementTab(): AccountManagementTab | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

export function subscribeRequestedAccountManagementTab(
  listener: (tab: AccountManagementTab) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
