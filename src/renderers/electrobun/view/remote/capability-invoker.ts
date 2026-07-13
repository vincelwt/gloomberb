import { withDeadline } from "../../../../utils/async-deadline";

type CapabilityRequest = <T>(method: string, payload: unknown) => Promise<T>;

export function createCapabilityInvoker(options: {
  request: CapabilityRequest;
  shouldApplyDeadline(capabilityId: string): boolean;
  timeoutMs: number;
}) {
  const inFlightRequests = new Map<string, Promise<unknown>>();

  return function invoke<T>(capabilityId: string, operationId: string, payload: unknown): Promise<T> {
    const requestPayload = { capabilityId, operationId, payload };
    const key = JSON.stringify(requestPayload);
    const inFlight = inFlightRequests.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const request = options.request<T>("capability.invoke", requestPayload);
    const boundedRequest = options.shouldApplyDeadline(capabilityId)
      ? withDeadline(
        request,
        options.timeoutMs,
        `Asset data request timed out after ${options.timeoutMs}ms: ${operationId}`,
      )
      : request;
    inFlightRequests.set(key, boundedRequest);
    void request.finally(() => {
      if (inFlightRequests.get(key) === boundedRequest) {
        inFlightRequests.delete(key);
      }
    }).catch(() => {
      // The returned bounded request owns error delivery to the caller.
    });
    return boundedRequest;
  };
}
