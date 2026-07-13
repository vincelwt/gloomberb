import type { RemoteJsonPatchOperation } from "./types";

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerSegments(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`JSON patch path must start with "/": ${path}`);
  }
  return path.slice(1).split("/").map(decodePointerSegment);
}

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeObjectKey(key: string): void {
  if (UNSAFE_OBJECT_KEYS.has(key)) {
    throw new Error(`Unsafe object key in JSON patch path: ${key}`);
  }
}

function cloneJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function containerFor(root: unknown, path: string): { parent: unknown; key: string } {
  const segments = pointerSegments(path);
  if (segments.length === 0) {
    throw new Error("Patch path cannot target the document root.");
  }
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new Error(`Invalid array index in JSON patch path: ${segment}`);
      }
      parent = parent[index];
    } else if (parent && typeof parent === "object") {
      assertSafeObjectKey(segment);
      if (!Object.prototype.hasOwnProperty.call(parent, segment)) {
        throw new Error(`Cannot descend into missing object key: ${segment}`);
      }
      parent = (parent as Record<string, unknown>)[segment];
    } else {
      throw new Error(`Cannot descend into non-object patch path: ${path}`);
    }
  }
  const key = segments[segments.length - 1]!;
  if (!Array.isArray(parent)) assertSafeObjectKey(key);
  return { parent, key };
}

function applyOperation(root: unknown, operation: RemoteJsonPatchOperation): void {
  const { parent, key } = containerFor(root, operation.path);
  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`Invalid array index in JSON patch path: ${key}`);
    }
    if (operation.op === "remove") {
      if (index >= parent.length) throw new Error(`Cannot remove missing array index: ${key}`);
      parent.splice(index, 1);
      return;
    }
    if (operation.op === "add") {
      parent.splice(index, 0, operation.value);
      return;
    }
    if (index >= parent.length) throw new Error(`Cannot replace missing array index: ${key}`);
    parent[index] = operation.value;
    return;
  }

  if (!parent || typeof parent !== "object") {
    throw new Error(`Cannot patch non-object at path: ${operation.path}`);
  }

  const target = parent as Record<string, unknown>;
  if (operation.op === "remove") {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      throw new Error(`Cannot remove missing key: ${key}`);
    }
    delete target[key];
    return;
  }
  if (operation.op === "replace" && !Object.prototype.hasOwnProperty.call(target, key)) {
    throw new Error(`Cannot replace missing key: ${key}`);
  }
  target[key] = operation.value;
}

export function applyJsonPatch<T>(value: T, patch: RemoteJsonPatchOperation[]): T {
  const next = cloneJson(value);
  for (const operation of patch) {
    if (operation.op !== "add" && operation.op !== "replace" && operation.op !== "remove") {
      throw new Error(`Unsupported JSON patch operation: ${(operation as { op?: unknown }).op}`);
    }
    applyOperation(next, operation);
  }
  return next;
}
