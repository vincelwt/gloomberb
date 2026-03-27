import type { LayoutConfig, DockedPaneEntry, FloatingPaneEntry, PaneLayoutEntry, LayoutColumnConfig } from "../types/config";
import type { PaneDef } from "../types/plugin";

export interface ResolvedPane {
  def: PaneDef;
  docked?: DockedPaneEntry;
  floating?: FloatingPaneEntry;
}

/** Resolve docked panes grouped by column index */
export function resolveDockedByColumn(
  layout: LayoutConfig,
  registeredPanes: ReadonlyMap<string, PaneDef>,
): Map<number, ResolvedPane[]> {
  const result = new Map<number, ResolvedPane[]>();

  for (const entry of layout.docked) {
    const def = registeredPanes.get(entry.paneId);
    if (!def) continue;
    const list = result.get(entry.columnIndex) ?? [];
    list.push({ def, docked: entry });
    result.set(entry.columnIndex, list);
  }

  // Sort each column by order
  for (const [, panes] of result) {
    panes.sort((a, b) => (a.docked!.order ?? 0) - (b.docked!.order ?? 0));
  }

  return result;
}

/** Resolve floating panes */
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
  // Sort by zIndex ascending (higher z on top)
  result.sort((a, b) => (a.floating!.zIndex ?? 50) - (b.floating!.zIndex ?? 50));
  return result;
}

/** Move a docked pane to floating (centered on screen) */
export function floatPane(
  layout: LayoutConfig,
  paneId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const docked = layout.docked.find((d) => d.paneId === paneId);
  if (!docked) return layout;

  const fw = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const fh = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - fw) / 2);
  const y = Math.floor((termHeight - fh) / 2);

  const maxZ = layout.floating.reduce((max, f) => Math.max(max, f.zIndex ?? 50), 50);

  const newLayout: LayoutConfig = {
    ...layout,
    docked: layout.docked.filter((d) => d.paneId !== paneId),
    floating: [...layout.floating, { paneId, x, y, width: fw, height: fh, zIndex: maxZ + 1 }],
  };

  return normalizeColumns(newLayout);
}

export interface DockTarget {
  relativeTo: string;
  position: "left" | "right" | "above" | "below";
}

/** Move a floating pane to docked, relative to an existing pane */
export function dockPane(
  layout: LayoutConfig,
  paneId: string,
  target: DockTarget,
): LayoutConfig {
  // Remove from floating
  const newFloating = layout.floating.filter((f) => f.paneId !== paneId);

  // Find the target docked pane
  const targetEntry = layout.docked.find((d) => d.paneId === target.relativeTo);
  if (!targetEntry) return layout;

  let newDocked = [...layout.docked];
  let newColumns = [...layout.columns];

  if (target.position === "above" || target.position === "below") {
    // Stack in same column
    const order = targetEntry.order ?? 0;
    const newOrder = target.position === "above" ? order - 1 : order + 1;
    newDocked.push({ paneId, columnIndex: targetEntry.columnIndex, order: newOrder });
  } else {
    // Create new column
    const insertIdx = target.position === "left" ? targetEntry.columnIndex : targetEntry.columnIndex + 1;

    // Shift existing column indices
    newDocked = newDocked.map((d) => ({
      ...d,
      columnIndex: d.columnIndex >= insertIdx ? d.columnIndex + 1 : d.columnIndex,
    }));

    // Insert new column
    newColumns.splice(insertIdx, 0, {});

    // Add the pane
    newDocked.push({ paneId, columnIndex: insertIdx });
  }

  return normalizeColumns({
    columns: newColumns,
    docked: newDocked,
    floating: newFloating,
  });
}

/** Add a pane that's not currently in the layout */
export function addPaneToLayout(
  layout: LayoutConfig,
  paneId: string,
  target: DockTarget,
): LayoutConfig {
  return dockPane(
    { ...layout, floating: [...layout.floating, { paneId, x: 0, y: 0, width: 0, height: 0 }] },
    paneId,
    target,
  );
}

/** Add a pane as floating */
export function addPaneFloating(
  layout: LayoutConfig,
  paneId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const fw = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const fh = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  const x = Math.floor((termWidth - fw) / 2);
  const y = Math.floor((termHeight - fh) / 2);
  const maxZ = layout.floating.reduce((max, f) => Math.max(max, f.zIndex ?? 50), 50);

  return {
    ...layout,
    floating: [...layout.floating, { paneId, x, y, width: fw, height: fh, zIndex: maxZ + 1 }],
  };
}

/** Remove a pane from the layout entirely */
export function removePane(layout: LayoutConfig, paneId: string): LayoutConfig {
  return normalizeColumns({
    ...layout,
    docked: layout.docked.filter((d) => d.paneId !== paneId),
    floating: layout.floating.filter((f) => f.paneId !== paneId),
  });
}

/** Remove empty columns and re-index */
export function normalizeColumns(layout: LayoutConfig): LayoutConfig {
  // Find which column indices are actually used
  const usedIndices = new Set(layout.docked.map((d) => d.columnIndex));

  if (usedIndices.size === layout.columns.length) return layout;
  if (usedIndices.size === 0 && layout.columns.length === 0) return layout;

  // Build mapping from old index to new index
  const sortedUsed = [...usedIndices].sort((a, b) => a - b);
  const indexMap = new Map<number, number>();
  sortedUsed.forEach((oldIdx, newIdx) => indexMap.set(oldIdx, newIdx));

  // Keep only used columns
  const newColumns: LayoutColumnConfig[] = sortedUsed.map((idx) => layout.columns[idx] ?? {});

  const newDocked = layout.docked.map((d) => ({
    ...d,
    columnIndex: indexMap.get(d.columnIndex) ?? d.columnIndex,
  }));

  return { columns: newColumns, docked: newDocked, floating: layout.floating };
}

/** Check if a pane is in the layout (docked or floating) */
export function isPaneInLayout(layout: LayoutConfig, paneId: string): boolean {
  return layout.docked.some((d) => d.paneId === paneId)
    || layout.floating.some((f) => f.paneId === paneId);
}

/** Update a floating pane's position/size */
export function updateFloatingPane(
  layout: LayoutConfig,
  paneId: string,
  updates: Partial<Pick<FloatingPaneEntry, "x" | "y" | "width" | "height" | "zIndex">>,
): LayoutConfig {
  return {
    ...layout,
    floating: layout.floating.map((f) =>
      f.paneId === paneId ? { ...f, ...updates } : f
    ),
  };
}

/** Bring a floating pane to front (highest zIndex) */
export function bringToFront(layout: LayoutConfig, paneId: string): LayoutConfig {
  const maxZ = layout.floating.reduce((max, f) => Math.max(max, f.zIndex ?? 50), 50);
  return updateFloatingPane(layout, paneId, { zIndex: maxZ + 1 });
}

/** Update a column's width */
export function updateColumnWidth(
  layout: LayoutConfig,
  columnIndex: number,
  width: string,
): LayoutConfig {
  const newColumns = layout.columns.map((c, i) =>
    i === columnIndex ? { ...c, width } : c
  );
  return { ...layout, columns: newColumns };
}

/** Parse a width string (e.g., "40%") into pixel count */
export function parseWidth(width: string | undefined, totalWidth: number): number | undefined {
  if (!width) return undefined;
  if (width.endsWith("%")) {
    const pct = parseInt(width, 10);
    return Math.floor((pct / 100) * totalWidth);
  }
  return parseInt(width, 10);
}

/** Migrate old PaneLayoutEntry[] to new LayoutConfig */
export function migrateLayout(raw: unknown): LayoutConfig {
  // Already new format
  if (raw && typeof raw === "object" && "columns" in raw) return raw as LayoutConfig;

  // Old format: PaneLayoutEntry[]
  if (Array.isArray(raw)) {
    const old = raw as PaneLayoutEntry[];
    const leftWidth = old.find((e) => e.position === "left")?.width ?? "40%";
    const rightWidth = old.find((e) => e.position === "right")?.width ?? "60%";
    const columns: LayoutColumnConfig[] = [{ width: leftWidth }, { width: rightWidth }];
    const docked: DockedPaneEntry[] = old.map((e) => ({
      paneId: e.paneId,
      columnIndex: e.position === "left" ? 0 : 1,
    }));
    return { columns, docked, floating: [] };
  }

  // Fallback
  return { columns: [], docked: [], floating: [] };
}
