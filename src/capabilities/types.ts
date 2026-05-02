import type { CachePolicyMap } from "../types/persistence";
import type { AssetDataProvider } from "../types/data-provider";
import type { NewsDataProvider } from "../types/capability-route-source";

export type CapabilityOperationKind = "read" | "query" | "action" | "stream";

export type CapabilityKind =
  | "asset-data"
  | "news"
  | "plugin-service";

export interface CapabilitySchema<T = unknown> {
  parse(value: unknown): T;
}

export interface CapabilityHandlerContext {
  capability: PluginCapability;
  operationId: string;
}

export type CapabilityStreamEmit<T = unknown> = (event: T) => void;

export interface CapabilityOperation<I = unknown, O = unknown, E = unknown> {
  kind: CapabilityOperationKind;
  rendererSafe?: boolean;
  input?: CapabilitySchema<I>;
  output?: CapabilitySchema<O>;
  cachePolicy?: CachePolicyMap[keyof CachePolicyMap];
  handler?: (input: I, ctx: CapabilityHandlerContext) => Promise<O> | O;
  subscribe?: (input: I, emit: CapabilityStreamEmit<E>, ctx: CapabilityHandlerContext) => (() => void) | Promise<() => void>;
}

export interface PluginCapability {
  readonly id: string;
  readonly kind: CapabilityKind | string;
  readonly name: string;
  readonly priority?: number;
  readonly cachePolicy?: CachePolicyMap;
  readonly sourceId?: string;
  readonly operations: Record<string, CapabilityOperation<any, any, any>>;
  isEnabled?(): boolean;
}

export interface AssetDataCapability extends PluginCapability {
  readonly kind: "asset-data";
  readonly provider: AssetDataProvider;
}

export interface NewsCapability extends PluginCapability {
  readonly kind: "news";
  readonly provider: NewsDataProvider;
}

export interface CapabilityOperationManifest {
  id: string;
  kind: CapabilityOperationKind;
  rendererSafe: boolean;
}

export interface CapabilityManifest {
  id: string;
  kind: string;
  name: string;
  priority?: number;
  sourceId?: string;
  operations: CapabilityOperationManifest[];
}

export interface CapabilityRegistryOptions {
  isPluginEnabled?(pluginId: string): boolean;
  isCapabilityEnabled?(capability: PluginCapability, pluginId: string): boolean;
}

export interface RegisteredCapability {
  pluginId: string;
  capability: PluginCapability;
}

export const unknownSchema: CapabilitySchema<unknown> = {
  parse(value) {
    return value;
  },
};

export const recordSchema: CapabilitySchema<Record<string, unknown>> = {
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  },
};
