import type { GloomPluginContext } from "../../../types/plugin";
import {
  deserializeAlerts,
  serializeAlerts,
} from "./alert-engine";
import { ALERTS_KEY } from "./constants";
import type { AlertRule } from "./types";

export function loadAlerts(ctx: GloomPluginContext): AlertRule[] {
  const json = ctx.configState.get<string>(ALERTS_KEY);
  if (!json) return [];
  return deserializeAlerts(json);
}

export function saveAlerts(
  ctx: GloomPluginContext,
  alerts: AlertRule[],
): void {
  ctx.configState.set(ALERTS_KEY, serializeAlerts(alerts));
}
