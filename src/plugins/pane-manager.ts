import type { DockedPaneEntry, FloatingPaneEntry, LayoutColumnConfig, LayoutConfig } from "../types/config";
import type { PaneDef } from "../types/plugin";

export interface ResolvedPane {
  def: PaneDef;
  docked?: DockedPaneEntry;
  floating?: FloatingPaneEntry;
}

export function resolveDockedByColumn(
  layout: LayoutConfig,
  registeredPanes: ReadonlyMap<string, PaneDef>,
): Map<number, ResolvedPane[]> {
  const result = new Map<number, ResolvedPane[]>();

  for (const entry of layout.docked) {
    const def = registeredPanes.get(entry.paneId);
    if (!def) continue;
    const panes = result.get(entry.columnIndex) ?? [];
    panes.push({ def, docked: entry });
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
    const def = registeredPanes.get(entry.paneId);
    if (!def) continue;
    result.push({ def, floating: entry });
  }
  result.sort((a, b) => (a.floating?.zIndex ?? 50) - (b.floating?.zIndex ?? 50));
  return result;
}

export function floatPane(
  layout: LayoutConfig,
  paneId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const docked = layout.docked.find((entry) => entry.paneId === paneId);
  if (!docked) return layout;

  const floatingWidth = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const floatingHeight = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - floatingWidth) / 2);
  const y = Math.floor((termHeight - floatingHeight) / 2);
  const maxZ = layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);

  return normalizeColumns({
    ...layout,
    docked: layout.docked.filter((entry) => entry.paneId !== paneId),
    floating: [...layout.floating, { paneId, x, y, width: floatingWidth, height: floatingHeight, zIndex: maxZ + 1 }],
  });
}

export interface DockTarget {
  relativeTo: string;
  position: "left" | "right" | "above" | "below";
}

export function dockPane(layout: LayoutConfig, paneId: string, target: DockTarget): LayoutConfig {
  const targetPane = layout.docked.find((entry) => entry.paneId === target.relativeTo);
  if (!targetPane) return layout;

  let docked = layout.docked.filter((entry) => entry.paneId !== paneId);
  const floating = layout.floating.filter((entry) => entry.paneId !== paneId);
  const columns = [...layout.columns];

  if (target.position === "above" || target.position === "below") {
    const siblingOrders = docked
      .filter((entry) => entry.columnIndex === targetPane.columnIndex)
      .map((entry) => entry.order ?? 0);
    const baseOrder = siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
    const order = target.position === "above" ? (targetPane.order ?? 0) - 1 : baseOrder;
    docked.push({ paneId, columnIndex: targetPane.columnIndex, order });
    return normalizeColumns({ columns, docked, floating });
  }

  const insertIndex = target.position === "left" ? targetPane.columnIndex : targetPane.columnIndex + 1;
  const shiftedDocked = docked.map((entry) => ({
    ...entry,
    columnIndex: entry.columnIndex >= insertIndex ? entry.columnIndex + 1 : entry.columnIndex,
  }));
  columns.splice(insertIndex, 0, {});
  shiftedDocked.push({ paneId, columnIndex: insertIndex, order: 0 });
  return normalizeColumns({ columns, docked: shiftedDocked, floating });
}

export function addPaneToLayout(layout: LayoutConfig, paneId: string, target: DockTarget): LayoutConfig {
  return dockPane(
    { ...layout, floating: [...layout.floating, { paneId, x: 0, y: 0, width: 0, height: 0 }] },
    paneId,
    target,
  );
}

export function addPaneFloating(
  layout: LayoutConfig,
  paneId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const floatingWidth = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const floatingHeight = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - floatingWidth) / 2);
  const y = Math.floor((termHeight - floatingHeight) / 2);
  const maxZ = layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);

  return {
    ...layout,
    floating: [...layout.floating, { paneId, x, y, width: floatingWidth, height: floatingHeight, zIndex: maxZ + 1 }],
  };
}

export function removePane(layout: LayoutConfig, paneId: string): LayoutConfig {
  return normalizeColumns({
    ...layout,
    docked: layout.docked.filter((entry) => entry.paneId !== paneId),
    floating: layout.floating.filter((entry) => entry.paneId !== paneId),
  });
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

  return { columns, docked, floating: layout.floating };
}

export function isPaneInLayout(layout: LayoutConfig, paneId: string): boolean {
  return layout.docked.some((entry) => entry.paneId === paneId)
    || layout.floating.some((entry) => entry.paneId === paneId);
}

export function updateFloatingPane(
  layout: LayoutConfig,
  paneId: string,
  updates: Partial<Pick<FloatingPaneEntry, "x" | "y" | "width" | "height" | "zIndex">>,
): LayoutConfig {
  return {
    ...layout,
    floating: layout.floating.map((entry) => (
      entry.paneId === paneId ? { ...entry, ...updates } : entry
    )),
  };
}

export function bringToFront(layout: LayoutConfig, paneId: string): LayoutConfig {
  const maxZ = layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);
  return updateFloatingPane(layout, paneId, { zIndex: maxZ + 1 });
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
