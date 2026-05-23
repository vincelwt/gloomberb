import type { ContextMenuContext, ContextMenuItem } from "../types/context-menu";
import type { ContextMenuProviderEntry } from "./registry-contributions";

interface ResolveRegistryContextMenuItemsOptions {
  context: ContextMenuContext;
  disabledPlugins: Set<string>;
  providers: Iterable<[string, ContextMenuProviderEntry]>;
  onProviderError: (entry: ContextMenuProviderEntry, error: unknown) => void;
}

export function resolveRegistryContextMenuItems({
  context,
  disabledPlugins,
  providers,
  onProviderError,
}: ResolveRegistryContextMenuItemsOptions): ContextMenuItem[] {
  const entries = [...providers]
    .filter(([, entry]) => !disabledPlugins.has(entry.pluginId))
    .filter(([, entry]) => !entry.provider.contexts || entry.provider.contexts.includes(context.kind))
    .sort((left, right) => (
      (left[1].provider.order ?? 0) - (right[1].provider.order ?? 0)
      || left[1].pluginId.localeCompare(right[1].pluginId)
      || left[1].provider.id.localeCompare(right[1].provider.id)
    ));

  const items: ContextMenuItem[] = [];
  for (const [, entry] of entries) {
    try {
      const provided = entry.provider.getItems(context);
      if (provided?.length) items.push(...provided);
    } catch (error) {
      onProviderError(entry, error);
    }
  }
  return items;
}
