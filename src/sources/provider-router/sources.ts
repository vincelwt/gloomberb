import type { AssetDataCapability, NewsCapability, PluginCapability } from "../../capabilities";
import type { CapabilityRouteSource } from "../../types/capability-route-source";
import type { DataProvider } from "../../types/data-provider";

type RouteSourceCapability = AssetDataCapability | NewsCapability;

export function normalizeRouteSource(source: CapabilityRouteSource | DataProvider): CapabilityRouteSource {
  return "market" in source || "news" in source
    ? source as CapabilityRouteSource
    : routeSourceFromMarketProvider(source as DataProvider);
}

export function collectCapabilityRouteSources(capabilities: PluginCapability[]): CapabilityRouteSource[] {
  const capabilitySources = new Map<string, CapabilityRouteSource>();
  for (const capability of capabilities) {
    if (!isRouteSourceCapability(capability)) continue;
    const sourceId = capabilityRouteSourceId(capability);
    capabilitySources.set(sourceId, mergeCapabilityRouteSource(capabilitySources.get(sourceId), capability));
  }
  return [...capabilitySources.values()];
}

function routeSourceFromMarketProvider(provider: DataProvider): CapabilityRouteSource {
  return {
    id: provider.id,
    name: provider.name,
    priority: provider.priority,
    cachePolicy: provider.cachePolicy,
    market: provider,
  };
}

function isRouteSourceCapability(capability: PluginCapability): capability is RouteSourceCapability {
  return capability.kind === "asset-data" || capability.kind === "news";
}

function capabilityRouteSourceId(capability: RouteSourceCapability): string {
  return capability.sourceId ?? capability.id;
}

function mergeCapabilityRouteSource(current: CapabilityRouteSource | undefined, capability: RouteSourceCapability): CapabilityRouteSource {
  const priority = Math.min(
    current?.priority ?? Number.MAX_SAFE_INTEGER,
    capability.priority ?? 1000,
  );
  return {
    id: capabilityRouteSourceId(capability),
    name: current?.name ?? capability.name,
    priority,
    cachePolicy: capability.cachePolicy ?? current?.cachePolicy,
    isEnabled: capability.isEnabled ?? current?.isEnabled,
    market: capability.kind === "asset-data" ? capability.provider : current?.market,
    news: capability.kind === "news" ? capability.provider : current?.news,
  };
}
