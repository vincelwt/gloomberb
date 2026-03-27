import type {
  DockedPaneEntry,
  FloatingPaneEntry,
  LayoutColumnConfig,
  LayoutConfig,
  PaneInstanceConfig,
} from "../types/config";
import type { PaneDef } from "../types/plugin";
import { createPaneInstance, findPaneInstance, normalizePaneLayout, removePaneInstances } from "../types/config";

export interface ResolvedPane {
  instance: PaneInstanceConfig;
  def: PaneDef;
  docked?: DockedPaneEntry;
  floating?: FloatingPaneEntry;
}

function pruneInstances(layout: LayoutConfig): LayoutConfig {
  const activeInstanceIds = new Set<string>([
    ...layout.docked.map((entry) => entry.instanceId),
    ...layout.floating.map((entry) => entry.instanceId),
  ]);
  return normalizePaneLayout(removePaneInstances(
    layout,
    layout.instances
      .filter((instance) => !activeInstanceIds.has(instance.instanceId))
      .map((instance) => instance.instanceId),
  ));
}

function ensurePaneInstance(layout: LayoutConfig, instance: PaneInstanceConfig): LayoutConfig {
  if (layout.instances.some((entry) => entry.instanceId === instance.instanceId)) return layout;
  return { ...layout, instances: [...layout.instances, instance] };
}

export function resolveDockedByColumn(
  layout: LayoutConfig,
  registeredPanes: ReadonlyMap<string, PaneDef>,
): Map<number, ResolvedPane[]> {
  const result = new Map<number, ResolvedPane[]>();

  for (const entry of layout.docked) {
    const instance = findPaneInstance(layout, entry.instanceId);
    if (!instance) continue;
    const def = registeredPanes.get(instance.paneId);
    if (!def) continue;
    const panes = result.get(entry.columnIndex) ?? [];
    panes.push({ instance, def, docked: entry });
    result.set(entry.columnIndex, panes);
  }

  for (const panes of result.values()) {
    panes.sort((a, b) => (a.docked?.order ?? 0) - (b.docked?.order ?? 0));
  }

  return result;
}

export function resolveFloating(
  layout: LayoutConfig,
  registeredPanes: ReadonlyMap<string, PaneDef>,
): ResolvedPane[] {
  const result: ResolvedPane[] = [];
  for (const entry of layout.floating) {
    const instance = findPaneInstance(layout, entry.instanceId);
    if (!instance) continue;
    const def = registeredPanes.get(instance.paneId);
    if (!def) continue;
    result.push({ instance, def, floating: entry });
  }
  result.sort((a, b) => (a.floating?.zIndex ?? 50) - (b.floating?.zIndex ?? 50));
  return result;
}

export function floatPane(
  layout: LayoutConfig,
  instanceId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const docked = layout.docked.find((entry) => entry.instanceId === instanceId);
  if (!docked) return layout;

  const floatingWidth = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const floatingHeight = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - floatingWidth) / 2);
  const y = Math.floor((termHeight - floatingHeight) / 2);
  const maxZ = layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);

  return normalizeColumns({
    ...layout,
    docked: layout.docked.filter((entry) => entry.instanceId !== instanceId),
    floating: [...layout.floating, { instanceId, x, y, width: floatingWidth, height: floatingHeight, zIndex: maxZ + 1 }],
  });
}

export interface DockTarget {
  relativeTo: string;
  position: "left" | "right" | "above" | "below";
}

export function dockPane(layout: LayoutConfig, instanceId: string, target: DockTarget): LayoutConfig {
  const targetPane = layout.docked.find((entry) => entry.instanceId === target.relativeTo);
  if (!targetPane) return layout;

  const docked = layout.docked.filter((entry) => entry.instanceId !== instanceId);
  const floating = layout.floating.filter((entry) => entry.instanceId !== instanceId);
  const columns = [...layout.columns];

  if (target.position === "above" || target.position === "below") {
    const siblingOrders = docked
      .filter((entry) => entry.columnIndex === targetPane.columnIndex)
      .map((entry) => entry.order ?? 0);
    const baseOrder = siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
    const order = target.position === "above" ? (targetPane.order ?? 0) - 1 : baseOrder;
    return normalizeColumns({ columns, instances: layout.instances, docked: [...docked, { instanceId, columnIndex: targetPane.columnIndex, order }], floating });
  }

  const insertIndex = target.position === "left" ? targetPane.columnIndex : targetPane.columnIndex + 1;
  const shiftedDocked = docked.map((entry) => ({
    ...entry,
    columnIndex: entry.columnIndex >= insertIndex ? entry.columnIndex + 1 : entry.columnIndex,
  }));
  columns.splice(insertIndex, 0, {});
  shiftedDocked.push({ instanceId, columnIndex: insertIndex, order: 0 });
  return normalizeColumns({ columns, instances: layout.instances, docked: shiftedDocked, floating });
}

export function addPaneToLayout(layout: LayoutConfig, instance: PaneInstanceConfig, target: DockTarget): LayoutConfig {
  const withInstance = ensurePaneInstance(layout, instance);
  return dockPane(
    { ...withInstance, floating: [...withInstance.floating, { instanceId: instance.instanceId, x: 0, y: 0, width: 0, height: 0 }] },
    instance.instanceId,
    target,
  );
}

export function addPaneFloating(
  layout: LayoutConfig,
  instance: PaneInstanceConfig | string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const resolvedInstance = typeof instance === "string" ? createPaneInstance(instance) : instance;
  const withInstance = ensurePaneInstance(layout, resolvedInstance);
  const floatingWidth = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const floatingHeight = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - floatingWidth) / 2);
  const y = Math.floor((termHeight - floatingHeight) / 2);
  const maxZ = withInstance.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);

  return {
    ...withInstance,
    floating: [...withInstance.floating, { instanceId: resolvedInstance.instanceId, x, y, width: floatingWidth, height: floatingHeight, zIndex: maxZ + 1 }],
  };
}

export function removePane(layout: LayoutConfig, instanceId: string): LayoutConfig {
  return pruneInstances(normalizePaneLayout(normalizeColumns({
    ...layout,
    docked: layout.docked.filter((entry) => entry.instanceId !== instanceId),
    floating: layout.floating.filter((entry) => entry.instanceId !== instanceId),
  })));
}

export function normalizeColumns(layout: LayoutConfig): LayoutConfig {
  const usedColumns = new Set(layout.docked.map((entry) => entry.columnIndex));
  if (usedColumns.size === layout.columns.length) return layout;
  if (usedColumns.size === 0 && layout.columns.length === 0) return layout;

  const sorted = [...usedColumns].sort((a, b) => a - b);
  const indexMap = new Map<number, number>();
  sorted.forEach((columnIndex, nextIndex) => indexMap.set(columnIndex, nextIndex));

  const columns: LayoutColumnConfig[] = sorted.map((columnIndex) => layout.columns[columnIndex] ?? {});
  const docked = layout.docked.map((entry) => ({
    ...entry,
    columnIndex: indexMap.get(entry.columnIndex) ?? entry.columnIndex,
  }));

  return { columns, instances: layout.instances, docked, floating: layout.floating };
}

export function isPaneInLayout(layout: LayoutConfig, instanceId: string): boolean {
  return layout.docked.some((entry) => entry.instanceId === instanceId)
    || layout.floating.some((entry) => entry.instanceId === instanceId);
}

export function updateFloatingPane(
  layout: LayoutConfig,
  instanceId: string,
  updates: Partial<Pick<FloatingPaneEntry, "x" | "y" | "width" | "height" | "zIndex">>,
): LayoutConfig {
  return {
    ...layout,
    floating: layout.floating.map((entry) => (
      entry.instanceId === instanceId ? { ...entry, ...updates } : entry
    )),
  };
}

export function bringToFront(layout: LayoutConfig, instanceId: string): LayoutConfig {
  const maxZ = layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);
  return updateFloatingPane(layout, instanceId, { zIndex: maxZ + 1 });
}

export function updateColumnWidth(layout: LayoutConfig, columnIndex: number, width: string): LayoutConfig {
  return {
    ...layout,
    columns: layout.columns.map((column, index) => (index === columnIndex ? { ...column, width } : column)),
  };
}

export function parseWidth(width: string | undefined, totalWidth: number): number | undefined {
  if (!width) return undefined;
  if (width.endsWith("%")) {
    const percent = parseInt(width, 10);
    return Math.floor((percent / 100) * totalWidth);
  }
  return parseInt(width, 10);
}
