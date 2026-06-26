export function loadNativeGatewayModule(): Promise<never> {
  return Promise.reject(new Error("IBKR native gateway is unavailable in the desktop web renderer."));
}
