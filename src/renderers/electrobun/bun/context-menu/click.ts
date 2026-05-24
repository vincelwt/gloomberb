export interface ContextMenuSelectionMessage {
  requestId: string;
  itemId: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contextMenuClickPayload(event: unknown): Record<string, unknown> | null {
  const eventRecord = record(event);
  if (!eventRecord) return null;

  const wrappedPayload = record(eventRecord.data);
  if (typeof wrappedPayload?.action === "string") {
    return wrappedPayload;
  }

  return typeof eventRecord.action === "string" ? eventRecord : null;
}

function decodeActionSelection(action: string, expectedAction: string): ContextMenuSelectionMessage | null {
  const prefix = `${expectedAction}:`;
  if (!action.startsWith(prefix)) return null;

  const [requestId, itemId] = action.slice(prefix.length).split(":").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (!requestId || !itemId) return null;

  return { requestId, itemId };
}

export function contextMenuSelectionMessage(
  event: unknown,
  expectedAction: string,
): ContextMenuSelectionMessage | null {
  const payload = contextMenuClickPayload(event);
  if (typeof payload?.action !== "string") return null;

  const actionMessage = decodeActionSelection(payload.action, expectedAction);
  if (actionMessage) return actionMessage;

  if (payload.action !== expectedAction) return null;

  const data = record(payload.data);
  if (typeof data?.requestId !== "string" || typeof data.itemId !== "string") {
    return null;
  }

  return {
    requestId: data.requestId,
    itemId: data.itemId,
  };
}
