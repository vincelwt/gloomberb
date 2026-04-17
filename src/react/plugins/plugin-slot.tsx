import type { GloomSlots } from "../../types/plugin";
import { getSharedRegistry } from "../../plugins/registry";
import { createElement } from "react";

export function PluginSlot<K extends keyof GloomSlots>({
  name,
  props,
}: {
  name: K;
  props?: GloomSlots[K];
}) {
  const registry = getSharedRegistry();
  if (!registry) return null;
  if (typeof registry.renderSlot === "function") {
    return registry.renderSlot(name, props ?? ({} as GloomSlots[K]));
  }
  if (registry.Slot) {
    return createElement(registry.Slot as any, { name, ...(props ?? {}) });
  }
  return null;
}
