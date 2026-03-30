import type {
  DockLayoutNode,
  DockedPlacementMemory,
  FloatingPaneEntry,
  FloatingPlacementMemory,
  LayoutConfig,
  PaneInstanceConfig,
} from "../types/config";
import type { PaneDef } from "../types/plugin";
import {
  clonePlacementMemory,
  createPaneInstance,
  findPaneInstance,
  normalizePaneLayout,
  removePaneInstances,
  type DockSplitNode,
} from "../types/config";

export const MIN_PANE_WIDTH = 20;
export const MIN_FLOAT_WIDTH = 15;
export const MIN_FLOAT_HEIGHT = 6;
export const MIN_DOCKED_HEIGHT = 5;

export interface ResolvedPane {
  instance: PaneInstanceConfig;
  def: PaneDef;
  floating?: FloatingPaneEntry;
  path?: Array<0 | 1>;
}

export interface DockTarget {
  relativeTo: string;
  position: "left" | "right" | "above" | "below";
}

export type GlobalDockRegion = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type LeafDropPosition =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type DropTarget =
  | { kind: "frame"; edge: "left" | "right" | "top" | "bottom" }
  | { kind: "leaf"; targetId: string; position: LeafDropPosition };

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLeafRef {
  instanceId: string;
  path: Array<0 | 1>;
}

export interface DockLeafLayout extends DockLeafRef {
  rect: LayoutBounds;
}

export interface DockDividerLayout {
  path: Array<0 | 1>;
  axis: DockSplitNode["axis"];
  rect: LayoutBounds;
  bounds: LayoutBounds;
  ratio: number;
}

export interface LayoutSimulation {
  layout: LayoutConfig;
  previewRect: LayoutBounds | null;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.max(0.1, Math.min(0.9, ratio));
}

function cloneDockNode(node: DockLayoutNode): DockLayoutNode {
  if (node.kind === "pane") {
    return { kind: "pane", instanceId: node.instanceId };
  }
  return {
    kind: "split",
    axis: node.axis,
    ratio: node.ratio,
    first: cloneDockNode(node.first),
    second: cloneDockNode(node.second),
  };
}

function ensurePaneInstance(layout: LayoutConfig, instance: PaneInstanceConfig): LayoutConfig {
  if (layout.instances.some((entry) => entry.instanceId === instance.instanceId)) return layout;
  return { ...layout, instances: [...layout.instances, instance] };
}

function clampFloatingRect(rect: FloatingRect, termWidth?: number, termHeight?: number): FloatingRect {
  const width = Math.max(MIN_FLOAT_WIDTH, Math.round(rect.width));
  const height = Math.max(MIN_FLOAT_HEIGHT, Math.round(rect.height));
  const maxX = typeof termWidth === "number" ? Math.max(0, termWidth - width) : Number.POSITIVE_INFINITY;
  const maxY = typeof termHeight === "number" ? Math.max(0, termHeight - height) : Number.POSITIVE_INFINITY;
  return {
    x: Math.max(0, Math.min(Math.round(rect.x), maxX)),
    y: Math.max(0, Math.min(Math.round(rect.y), maxY)),
    width,
    height,
    zIndex: rect.zIndex,
  };
}

function defaultFloatingRect(termWidth: number, termHeight: number, def?: PaneDef): FloatingRect {
  const width = def?.defaultFloatingSize?.width ?? Math.floor(termWidth * 0.6);
  const height = def?.defaultFloatingSize?.height ?? Math.floor(termHeight * 0.6);
  return clampFloatingRect({
    x: Math.floor((termWidth - width) / 2),
    y: Math.floor((termHeight - height) / 2),
    width,
    height,
  }, termWidth, termHeight);
}

function maxFloatingZ(layout: LayoutConfig): number {
  return layout.floating.reduce((highest, entry) => Math.max(highest, entry.zIndex ?? 50), 50);
}

function collectDockLeafRefs(node: DockLayoutNode | null, path: Array<0 | 1> = [], result: DockLeafRef[] = []): DockLeafRef[] {
  if (!node) return result;
  if (node.kind === "pane") {
    result.push({ instanceId: node.instanceId, path });
    return result;
  }
  collectDockLeafRefs(node.first, [...path, 0], result);
  collectDockLeafRefs(node.second, [...path, 1], result);
  return result;
}

function getDockedInstanceIds(node: DockLayoutNode | null): string[] {
  return collectDockLeafRefs(node).map((entry) => entry.instanceId);
}

function getRepresentativeLeafId(node: DockLayoutNode, preferStart: boolean): string {
  if (node.kind === "pane") return node.instanceId;
  return getRepresentativeLeafId(preferStart ? node.first : node.second, preferStart);
}

function getNodeAtPath(node: DockLayoutNode | null, path: Array<0 | 1>): DockLayoutNode | null {
  let current = node;
  for (const segment of path) {
    if (!current || current.kind !== "split") return null;
    current = segment === 0 ? current.first : current.second;
  }
  return current;
}

function replaceNodeAtPath(node: DockLayoutNode, path: Array<0 | 1>, replacement: DockLayoutNode): DockLayoutNode {
  if (path.length === 0) return replacement;
  if (node.kind !== "split") return node;
  const [head, ...rest] = path;
  if (head === 0) {
    return {
      ...node,
      first: replaceNodeAtPath(node.first, rest as Array<0 | 1>, replacement),
    };
  }
  return {
    ...node,
    second: replaceNodeAtPath(node.second, rest as Array<0 | 1>, replacement),
  };
}

function removeNodeAtPath(node: DockLayoutNode | null, path: Array<0 | 1>): DockLayoutNode | null {
  if (!node) return null;
  if (path.length === 0) return null;
  if (node.kind !== "split") return node;

  const [head, ...rest] = path;
  if (head === 0) {
    const first = removeNodeAtPath(node.first, rest as Array<0 | 1>);
    if (!first) return node.second;
    return { ...node, first };
  }

  const second = removeNodeAtPath(node.second, rest as Array<0 | 1>);
  if (!second) return node.first;
  return { ...node, second };
}

function normalizeFloatingEntries(layout: LayoutConfig): FloatingPaneEntry[] {
  const dockedIds = new Set(getDockedInstanceIds(layout.dockRoot));
  const seen = new Set<string>();
  return layout.floating
    .filter((entry) => !dockedIds.has(entry.instanceId))
    .filter((entry) => {
      if (seen.has(entry.instanceId)) return false;
      seen.add(entry.instanceId);
      return true;
    })
    .map((entry) => ({ ...entry }));
}

function captureDockedMemory(layout: LayoutConfig, dockRoot: DockLayoutNode | null): Map<string, DockedPlacementMemory> {
  const memory = new Map<string, DockedPlacementMemory>();
  const leaves = collectDockLeafRefs(dockRoot);

  for (const leaf of leaves) {
    if (leaf.path.length === 0) {
      memory.set(leaf.instanceId, { path: [] });
      continue;
    }

    const parentPath = leaf.path.slice(0, -1);
    const branch = leaf.path[leaf.path.length - 1]!;
    const parent = getNodeAtPath(dockRoot, parentPath);
    if (!parent || parent.kind !== "split") {
      memory.set(leaf.instanceId, { path: [...leaf.path] });
      continue;
    }

    const sibling = branch === 0 ? parent.second : parent.first;
    const position = parent.axis === "horizontal"
      ? (branch === 0 ? "left" : "right")
      : (branch === 0 ? "above" : "below");

    memory.set(leaf.instanceId, {
      path: [...leaf.path],
      anchorInstanceId: getRepresentativeLeafId(sibling, branch === 0),
      position,
    });
  }

  return memory;
}

function capturePlacementMemory(layout: LayoutConfig): LayoutConfig {
  const dockedMemory = captureDockedMemory(layout, layout.dockRoot);
  const floatingById = new Map(layout.floating.map((entry) => [entry.instanceId, entry] as const));

  return {
    ...layout,
    instances: layout.instances.map((instance) => {
      const previous = clonePlacementMemory(instance.placementMemory) ?? {};
      const nextDocked = dockedMemory.get(instance.instanceId) ?? previous.docked;
      const floating = floatingById.get(instance.instanceId);
      const nextFloating = floating ? {
        x: floating.x,
        y: floating.y,
        width: floating.width,
        height: floating.height,
      } : previous.floating;

      return {
        ...instance,
        placementMemory: nextDocked || nextFloating ? {
          docked: nextDocked,
          floating: nextFloating,
        } : undefined,
      };
    }),
  };
}

function finalizeLayout(layout: LayoutConfig): LayoutConfig {
  const normalized = normalizePaneLayout({
    ...layout,
    floating: normalizeFloatingEntries(layout),
  });
  return capturePlacementMemory(normalized);
}

function buildSplitAroundNode(
  existing: DockLayoutNode,
  instanceId: string,
  position: DockTarget["position"],
): DockLayoutNode {
  const dragged: DockLayoutNode = { kind: "pane", instanceId };
  const axis = position === "left" || position === "right" ? "horizontal" : "vertical";
  const first = position === "left" || position === "above" ? dragged : existing;
  const second = position === "left" || position === "above" ? existing : dragged;
  return {
    kind: "split",
    axis,
    ratio: 0.5,
    first,
    second,
  };
}

function removeDockedLeaf(layout: LayoutConfig, instanceId: string): LayoutConfig {
  const leaf = findDockLeaf(layout, instanceId);
  if (!leaf) return layout;
  return {
    ...layout,
    dockRoot: removeNodeAtPath(layout.dockRoot, leaf.path),
  };
}

function detachPane(layout: LayoutConfig, instanceId: string): LayoutConfig {
  return {
    ...removeDockedLeaf(layout, instanceId),
    floating: layout.floating.filter((entry) => entry.instanceId !== instanceId),
  };
}

function insertRelativeToSubtreePath(
  layout: LayoutConfig,
  instanceId: string,
  targetPath: Array<0 | 1>,
  position: DockTarget["position"],
): LayoutConfig {
  const base = detachPane(layout, instanceId);
  if (!base.dockRoot) {
    return finalizeLayout({ ...base, dockRoot: { kind: "pane", instanceId } });
  }

  let candidatePath = [...targetPath];
  let targetNode = getNodeAtPath(base.dockRoot, candidatePath);
  while (!targetNode && candidatePath.length > 0) {
    candidatePath = candidatePath.slice(0, -1);
    targetNode = getNodeAtPath(base.dockRoot, candidatePath);
  }

  if (!targetNode) {
    return finalizeLayout({
      ...base,
      dockRoot: buildSplitAroundNode(base.dockRoot, instanceId, position),
    });
  }

  const replacement = buildSplitAroundNode(targetNode, instanceId, position);
  return finalizeLayout({
    ...base,
    dockRoot: replaceNodeAtPath(base.dockRoot, candidatePath, replacement),
  });
}

function scoreDirectionalCandidate(
  current: DockLeafLayout,
  candidate: DockLeafLayout,
  direction: DockTarget["position"],
): number | null {
  const currentCenterX = current.rect.x + Math.floor(current.rect.width / 2);
  const currentCenterY = current.rect.y + Math.floor(current.rect.height / 2);
  const candidateCenterX = candidate.rect.x + Math.floor(candidate.rect.width / 2);
  const candidateCenterY = candidate.rect.y + Math.floor(candidate.rect.height / 2);

  if (direction === "left" && candidateCenterX >= currentCenterX) return null;
  if (direction === "right" && candidateCenterX <= currentCenterX) return null;
  if (direction === "above" && candidateCenterY >= currentCenterY) return null;
  if (direction === "below" && candidateCenterY <= currentCenterY) return null;

  const primaryDelta = direction === "left" || direction === "right"
    ? Math.abs(currentCenterX - candidateCenterX)
    : Math.abs(currentCenterY - candidateCenterY);
  const secondaryDelta = direction === "left" || direction === "right"
    ? Math.abs(currentCenterY - candidateCenterY)
    : Math.abs(currentCenterX - candidateCenterX);

  return primaryDelta * 1000 + secondaryDelta;
}

function resolveSplitSizes(total: number, ratio: number, minSize: number): [number, number] {
  if (total <= 1) return [1, 0];
  if (total < minSize * 2) {
    const first = Math.max(1, Math.floor(total / 2));
    return [first, Math.max(1, total - first)];
  }
  const preferred = Math.round(total * clampRatio(ratio));
  const first = Math.max(minSize, Math.min(total - minSize, preferred));
  return [first, total - first];
}

function collectDockGeometry(
  node: DockLayoutNode | null,
  bounds: LayoutBounds,
  path: Array<0 | 1> = [],
  leaves: DockLeafLayout[] = [],
  dividers: DockDividerLayout[] = [],
): { leaves: DockLeafLayout[]; dividers: DockDividerLayout[] } {
  if (!node) return { leaves, dividers };
  if (node.kind === "pane") {
    leaves.push({ instanceId: node.instanceId, path, rect: { ...bounds } });
    return { leaves, dividers };
  }

  if (node.axis === "horizontal") {
    const [firstWidth, secondWidth] = resolveSplitSizes(bounds.width, node.ratio, MIN_PANE_WIDTH);
    const firstBounds = { x: bounds.x, y: bounds.y, width: firstWidth, height: bounds.height };
    const secondBounds = { x: bounds.x + firstWidth, y: bounds.y, width: secondWidth, height: bounds.height };
    dividers.push({
      path,
      axis: node.axis,
      bounds: { ...bounds },
      ratio: node.ratio,
      rect: {
        x: bounds.x + firstWidth - 1,
        y: bounds.y,
        width: 1,
        height: bounds.height,
      },
    });
    collectDockGeometry(node.first, firstBounds, [...path, 0], leaves, dividers);
    collectDockGeometry(node.second, secondBounds, [...path, 1], leaves, dividers);
    return { leaves, dividers };
  }

  const [firstHeight, secondHeight] = resolveSplitSizes(bounds.height, node.ratio, MIN_DOCKED_HEIGHT);
  const firstBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: firstHeight };
  const secondBounds = { x: bounds.x, y: bounds.y + firstHeight, width: bounds.width, height: secondHeight };
  dividers.push({
    path,
    axis: node.axis,
    bounds: { ...bounds },
    ratio: node.ratio,
    rect: {
      x: bounds.x,
      y: bounds.y + firstHeight - 1,
      width: bounds.width,
      height: 1,
    },
  });
  collectDockGeometry(node.first, firstBounds, [...path, 0], leaves, dividers);
  collectDockGeometry(node.second, secondBounds, [...path, 1], leaves, dividers);
  return { leaves, dividers };
}

function countColumnsFromGeometry(geometry: DockLeafLayout[]): number {
  if (geometry.length === 0) return 0;
  const midY = geometry.reduce((sum, entry) => sum + entry.rect.y + Math.floor(entry.rect.height / 2), 0) / geometry.length;
  return geometry.filter((entry) => midY >= entry.rect.y && midY < entry.rect.y + entry.rect.height).length;
}

function normalizeDropPosition(position: LeafDropPosition): "left" | "right" | "top" | "bottom" | "center" {
  switch (position) {
    case "top-left":
    case "top-right":
      return "top";
    case "bottom-left":
    case "bottom-right":
      return "bottom";
    default:
      return position;
  }
}

function buildGridDockTree(instanceIds: string[], depth = 0): DockLayoutNode | null {
  if (instanceIds.length === 0) return null;
  if (instanceIds.length === 1) return { kind: "pane", instanceId: instanceIds[0]! };
  const splitIndex = Math.ceil(instanceIds.length / 2);
  return {
    kind: "split",
    axis: depth % 2 === 0 ? "horizontal" : "vertical",
    ratio: splitIndex / instanceIds.length,
    first: buildGridDockTree(instanceIds.slice(0, splitIndex), depth + 1)!,
    second: buildGridDockTree(instanceIds.slice(splitIndex), depth + 1)!,
  };
}

interface GridlockRect {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsForRects(rects: GridlockRect[]): LayoutBounds {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function clampGridlockRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.1, Math.min(0.9, value));
}

function inferSplitCandidate(
  rects: GridlockRect[],
  axis: "horizontal" | "vertical",
  bounds: LayoutBounds,
): { axis: "horizontal" | "vertical"; ratio: number; first: GridlockRect[]; second: GridlockRect[] } | null {
  const tolerance = 1;
  const candidates = new Set<number>();

  for (const rect of rects) {
    if (axis === "horizontal") {
      candidates.add(rect.y);
      candidates.add(rect.y + rect.height);
    } else {
      candidates.add(rect.x);
      candidates.add(rect.x + rect.width);
    }
  }

  const minBound = axis === "horizontal" ? bounds.y : bounds.x;
  const maxBound = axis === "horizontal" ? bounds.y + bounds.height : bounds.x + bounds.width;

  let best: { ratio: number; first: GridlockRect[]; second: GridlockRect[]; score: number } | null = null;
  for (const candidate of candidates) {
    if (candidate <= minBound + tolerance || candidate >= maxBound - tolerance) continue;

    const first: GridlockRect[] = [];
    const second: GridlockRect[] = [];
    let valid = true;

    for (const rect of rects) {
      const start = axis === "horizontal" ? rect.y : rect.x;
      const end = axis === "horizontal" ? rect.y + rect.height : rect.x + rect.width;

      if (end <= candidate + tolerance) {
        first.push(rect);
      } else if (start >= candidate - tolerance) {
        second.push(rect);
      } else {
        valid = false;
        break;
      }
    }

    if (!valid || first.length === 0 || second.length === 0) continue;

    const ratio = axis === "horizontal"
      ? clampGridlockRatio((candidate - bounds.y) / Math.max(1, bounds.height))
      : clampGridlockRatio((candidate - bounds.x) / Math.max(1, bounds.width));
    const balance = Math.abs(first.length - second.length);
    const centerBias = Math.abs(ratio - 0.5);
    const score = balance * 10 + centerBias;

    if (!best || score < best.score) {
      best = { ratio, first, second, score };
    }
  }

  return best ? { axis, ratio: best.ratio, first: best.first, second: best.second } : null;
}

function inferDockTreeFromRects(rects: GridlockRect[], bounds?: LayoutBounds): DockLayoutNode | null {
  if (rects.length === 0) return null;
  if (rects.length === 1) return { kind: "pane", instanceId: rects[0]!.instanceId };

  const rectBounds = bounds ?? boundsForRects(rects);
  const preferredAxis = rectBounds.width >= rectBounds.height ? "vertical" : "horizontal";
  const primary = inferSplitCandidate(rects, preferredAxis, rectBounds);
  const secondary = inferSplitCandidate(rects, preferredAxis === "vertical" ? "horizontal" : "vertical", rectBounds);
  const chosen = primary ?? secondary;

  if (!chosen) {
    return buildGridDockTree(
      [...rects].sort((a, b) => a.y - b.y || a.x - b.x).map((rect) => rect.instanceId),
    );
  }

  return {
    kind: "split",
    axis: chosen.axis === "vertical" ? "horizontal" : "vertical",
    ratio: chosen.ratio,
    first: inferDockTreeFromRects(chosen.first, boundsForRects(chosen.first))!,
    second: inferDockTreeFromRects(chosen.second, boundsForRects(chosen.second))!,
  };
}

export function traverseDockLeaves(layout: LayoutConfig): DockLeafRef[] {
  return collectDockLeafRefs(layout.dockRoot);
}

export function getDockedPaneIds(layout: LayoutConfig): string[] {
  return getDockedInstanceIds(layout.dockRoot);
}

export function findDockLeaf(layout: LayoutConfig, instanceId: string): DockLeafRef | null {
  return traverseDockLeaves(layout).find((entry) => entry.instanceId === instanceId) ?? null;
}

export function getDockLeafLayouts(layout: LayoutConfig, bounds: LayoutBounds): DockLeafLayout[] {
  return collectDockGeometry(layout.dockRoot, bounds).leaves;
}

export function getDockDividerLayouts(layout: LayoutConfig, bounds: LayoutBounds): DockDividerLayout[] {
  return collectDockGeometry(layout.dockRoot, bounds).dividers;
}

export function getLeafRect(layout: LayoutConfig, instanceId: string, bounds: LayoutBounds): LayoutBounds | null {
  return getDockLeafLayouts(layout, bounds).find((entry) => entry.instanceId === instanceId)?.rect ?? null;
}

export function resolveDocked(
  layout: LayoutConfig,
  registeredPanes: ReadonlyMap<string, PaneDef>,
): ResolvedPane[] {
  return traverseDockLeaves(layout)
    .map((leaf) => {
      const instance = findPaneInstance(layout, leaf.instanceId);
      if (!instance) return null;
      const def = registeredPanes.get(instance.paneId);
      if (!def) return null;
      return { instance, def, path: leaf.path };
    })
    .filter((pane): pane is ResolvedPane => pane !== null);
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

export function floatAtRect(layout: LayoutConfig, instanceId: string, rect: FloatingRect): LayoutConfig {
  const base = detachPane(layout, instanceId);
  return finalizeLayout({
    ...base,
    floating: [
      ...base.floating.filter((entry) => entry.instanceId !== instanceId),
      {
        instanceId,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: rect.zIndex ?? maxFloatingZ(layout) + 1,
      },
    ],
  });
}

export function floatPane(
  layout: LayoutConfig,
  instanceId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const instance = findPaneInstance(layout, instanceId);
  if (!instance) return layout;
  const remembered = instance.placementMemory?.floating;
  const rect = remembered
    ? clampFloatingRect(remembered, termWidth, termHeight)
    : defaultFloatingRect(termWidth, termHeight, def);
  return floatAtRect(layout, instanceId, rect);
}

export function insertRelativeToLeaf(layout: LayoutConfig, instanceId: string, targetId: string, position: DockTarget["position"]): LayoutConfig {
  if (instanceId === targetId) return layout;
  const base = detachPane(layout, instanceId);
  const targetLeaf = findDockLeaf(base, targetId);
  if (!targetLeaf || !base.dockRoot) return layout;
  const targetNode = getNodeAtPath(base.dockRoot, targetLeaf.path);
  if (!targetNode) return layout;
  return finalizeLayout({
    ...base,
    dockRoot: replaceNodeAtPath(base.dockRoot, targetLeaf.path, buildSplitAroundNode(targetNode, instanceId, position)),
  });
}

export function insertAtRootEdge(layout: LayoutConfig, instanceId: string, edge: "left" | "right" | "top" | "bottom"): LayoutConfig {
  const base = detachPane(layout, instanceId);
  if (!base.dockRoot) {
    return finalizeLayout({ ...base, dockRoot: { kind: "pane", instanceId } });
  }
  return finalizeLayout({
    ...base,
    dockRoot: buildSplitAroundNode(base.dockRoot, instanceId, edge === "top" ? "above" : edge === "bottom" ? "below" : edge),
  });
}

export function dockAtTarget(layout: LayoutConfig, instanceId: string, target: DockTarget): LayoutConfig {
  return insertRelativeToLeaf(layout, instanceId, target.relativeTo, target.position);
}

export function dockPane(layout: LayoutConfig, instanceId: string, target?: DockTarget): LayoutConfig {
  if (target) return dockAtTarget(layout, instanceId, target);

  const instance = findPaneInstance(layout, instanceId);
  const dockedMemory = instance?.placementMemory?.docked;
  if (dockedMemory?.position && dockedMemory.path && dockedMemory.path.length > 0) {
    return insertRelativeToSubtreePath(layout, instanceId, dockedMemory.path.slice(0, -1), dockedMemory.position);
  }
  if (dockedMemory?.anchorInstanceId && dockedMemory.position && findDockLeaf(layout, dockedMemory.anchorInstanceId)) {
    return insertRelativeToLeaf(layout, instanceId, dockedMemory.anchorInstanceId, dockedMemory.position);
  }
  if (!layout.dockRoot) {
    return finalizeLayout({ ...detachPane(layout, instanceId), dockRoot: { kind: "pane", instanceId } });
  }
  return insertAtRootEdge(layout, instanceId, "right");
}

export function dockPaneToRegion(layout: LayoutConfig, instanceId: string, region: GlobalDockRegion): LayoutConfig {
  switch (region) {
    case "left":
      return insertAtRootEdge(layout, instanceId, "left");
    case "right":
      return insertAtRootEdge(layout, instanceId, "right");
    case "top":
    case "top-left":
    case "top-right":
      return insertAtRootEdge(layout, instanceId, "top");
    case "bottom":
    case "bottom-left":
    case "bottom-right":
      return insertAtRootEdge(layout, instanceId, "bottom");
  }
}

export function insertIntoQuadrant(layout: LayoutConfig, instanceId: string, targetId: string, quadrant: Exclude<LeafDropPosition, "left" | "right" | "top" | "bottom" | "center">): LayoutConfig {
  const normalized = normalizeDropPosition(quadrant);
  return insertRelativeToLeaf(layout, instanceId, targetId, normalized === "top" ? "above" : normalized === "bottom" ? "below" : normalized);
}

export function applyDrop(layout: LayoutConfig, draggedId: string, dropTarget: DropTarget): LayoutConfig {
  if (dropTarget.kind === "frame") {
    return insertAtRootEdge(layout, draggedId, dropTarget.edge);
  }

  const normalized = normalizeDropPosition(dropTarget.position);
  if (normalized === "center") {
    return swapPanes(layout, draggedId, dropTarget.targetId);
  }
  const direction = normalized === "top" ? "above" : normalized === "bottom" ? "below" : normalized;
  return insertRelativeToLeaf(layout, draggedId, dropTarget.targetId, direction);
}

export function simulateDrop(layout: LayoutConfig, draggedId: string, dropTarget: DropTarget, bounds: LayoutBounds): LayoutSimulation {
  const nextLayout = applyDrop(layout, draggedId, dropTarget);
  return {
    layout: nextLayout,
    previewRect: getLeafRect(nextLayout, draggedId, bounds),
  };
}

export function movePaneRelative(
  layout: LayoutConfig,
  instanceId: string,
  position: DockTarget["position"],
): LayoutConfig {
  const floating = layout.floating.find((entry) => entry.instanceId === instanceId);
  if (floating) {
    const deltaX = position === "left" ? -2 : position === "right" ? 2 : 0;
    const deltaY = position === "above" ? -1 : position === "below" ? 1 : 0;
    return finalizeLayout(updateFloatingPane(layout, instanceId, {
      x: Math.max(0, floating.x + deltaX),
      y: Math.max(0, floating.y + deltaY),
    }));
  }

  const currentRect = getLeafRect(layout, instanceId, { x: 0, y: 0, width: 120, height: 40 });
  if (!currentRect) return layout;
  const candidates = getDockLeafLayouts(layout, { x: 0, y: 0, width: 120, height: 40 })
    .filter((entry) => entry.instanceId !== instanceId)
    .map((entry) => ({ entry, score: scoreDirectionalCandidate({ instanceId, path: [], rect: currentRect }, entry, position) }))
    .filter((entry): entry is { entry: DockLeafLayout; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score);
  const target = candidates[0]?.entry;
  if (!target) return layout;
  return insertRelativeToLeaf(layout, instanceId, target.instanceId, position);
}

export function swapLeaves(layout: LayoutConfig, firstId: string, secondId: string): LayoutConfig {
  return swapPanes(layout, firstId, secondId);
}

export function swapPanes(layout: LayoutConfig, firstId: string, secondId: string): LayoutConfig {
  if (firstId === secondId) return layout;
  const firstLeaf = findDockLeaf(layout, firstId);
  const secondLeaf = findDockLeaf(layout, secondId);
  const firstFloating = layout.floating.find((entry) => entry.instanceId === firstId);
  const secondFloating = layout.floating.find((entry) => entry.instanceId === secondId);
  if (!firstLeaf && !firstFloating) return layout;
  if (!secondLeaf && !secondFloating) return layout;

  if (firstLeaf && secondLeaf && layout.dockRoot) {
    const firstNode = getNodeAtPath(layout.dockRoot, firstLeaf.path);
    const secondNode = getNodeAtPath(layout.dockRoot, secondLeaf.path);
    if (!firstNode || !secondNode || firstNode.kind !== "pane" || secondNode.kind !== "pane") return layout;
    const withFirst = replaceNodeAtPath(layout.dockRoot, firstLeaf.path, { kind: "pane", instanceId: secondId });
    const withSecond = replaceNodeAtPath(withFirst, secondLeaf.path, { kind: "pane", instanceId: firstId });
    return finalizeLayout({ ...layout, dockRoot: withSecond });
  }

  if (firstFloating && secondFloating) {
    return finalizeLayout({
      ...layout,
      floating: layout.floating.map((entry) => {
        if (entry.instanceId === firstId) return { ...secondFloating, instanceId: firstId };
        if (entry.instanceId === secondId) return { ...firstFloating, instanceId: secondId };
        return entry;
      }),
    });
  }

  const dockedId = firstLeaf ? firstId : secondId;
  const floatingId = firstFloating ? firstId : secondId;
  const dockedLeaf = firstLeaf ?? secondLeaf!;
  const floatingEntry = firstFloating ?? secondFloating!;
  const base = layout.dockRoot && dockedLeaf
    ? replaceNodeAtPath(layout.dockRoot, dockedLeaf.path, { kind: "pane", instanceId: floatingId })
    : layout.dockRoot;

  return finalizeLayout({
    ...layout,
    dockRoot: base,
    floating: [
      ...layout.floating.filter((entry) => entry.instanceId !== floatingId),
      {
        instanceId: dockedId,
        x: floatingEntry.x,
        y: floatingEntry.y,
        width: floatingEntry.width,
        height: floatingEntry.height,
        zIndex: floatingEntry.zIndex,
      },
    ],
  });
}

export function removeLeafAndCollapse(layout: LayoutConfig, instanceId: string): LayoutConfig {
  return finalizeLayout(removeDockedLeaf(layout, instanceId));
}

export function resizeSplitAtPath(layout: LayoutConfig, path: Array<0 | 1>, ratio: number): LayoutConfig {
  const target = getNodeAtPath(layout.dockRoot, path);
  if (!target || target.kind !== "split" || !layout.dockRoot) return layout;
  return finalizeLayout({
    ...layout,
    dockRoot: replaceNodeAtPath(layout.dockRoot, path, {
      ...target,
      ratio: clampRatio(ratio),
    }),
  });
}

export function restorePlacementMemory(
  layout: LayoutConfig,
  instanceId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): LayoutConfig {
  const isFloating = layout.floating.some((entry) => entry.instanceId === instanceId);
  if (isFloating) return dockPane(layout, instanceId);
  return floatPane(layout, instanceId, termWidth, termHeight, def);
}

export function addPaneToLayout(layout: LayoutConfig, instance: PaneInstanceConfig, target: DockTarget): LayoutConfig {
  const withInstance = ensurePaneInstance(layout, instance);
  if (!withInstance.dockRoot) {
    return finalizeLayout({
      ...withInstance,
      dockRoot: { kind: "pane", instanceId: instance.instanceId },
    });
  }
  return dockAtTarget(withInstance, instance.instanceId, target);
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
  return floatPane(withInstance, resolvedInstance.instanceId, termWidth, termHeight, def);
}

export function removePane(layout: LayoutConfig, instanceId: string): LayoutConfig {
  return finalizeLayout(removePaneInstances(
    {
      ...layout,
      dockRoot: removeDockedLeaf(layout, instanceId).dockRoot,
      floating: layout.floating.filter((entry) => entry.instanceId !== instanceId),
    },
    [instanceId],
  ));
}

export function isPaneInLayout(layout: LayoutConfig, instanceId: string): boolean {
  return !!findDockLeaf(layout, instanceId)
    || layout.floating.some((entry) => entry.instanceId === instanceId);
}

export function isPaneDocked(layout: LayoutConfig, instanceId: string): boolean {
  return !!findDockLeaf(layout, instanceId);
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
  return finalizeLayout(updateFloatingPane(layout, instanceId, { zIndex: maxFloatingZ(layout) + 1 }));
}

export function getLayoutPreview(layout: LayoutConfig): string {
  const geometry = getDockLeafLayouts(layout, { x: 0, y: 0, width: 120, height: 40 });
  return `${countColumnsFromGeometry(geometry)}c / ${geometry.length}d / ${layout.floating.length}f`;
}

export function gridlockAllPanes(
  layout: LayoutConfig,
  bounds: LayoutBounds = { x: 0, y: 0, width: 120, height: 40 },
): LayoutConfig {
  const dockedRects: GridlockRect[] = getDockLeafLayouts(layout, bounds)
    .map((leaf) => ({ instanceId: leaf.instanceId, ...leaf.rect }));
  const floatingRects: GridlockRect[] = layout.floating.map((entry) => ({
    instanceId: entry.instanceId,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  }));
  const allRects = [...dockedRects, ...floatingRects];
  if (allRects.length === 0) return layout;

  return finalizeLayout({
    ...layout,
    dockRoot: inferDockTreeFromRects(allRects, boundsForRects(allRects)),
    floating: [],
  });
}

export function getRememberedFloatingRect(
  layout: LayoutConfig,
  instanceId: string,
  termWidth: number,
  termHeight: number,
  def?: PaneDef,
): FloatingPlacementMemory {
  const instance = findPaneInstance(layout, instanceId);
  const remembered = instance?.placementMemory?.floating;
  return remembered
    ? clampFloatingRect(remembered, termWidth, termHeight)
    : defaultFloatingRect(termWidth, termHeight, def);
}
