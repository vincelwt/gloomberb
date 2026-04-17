import { type NativeRendererHost as CliRenderer } from "../../../ui";
import { writeRendererRaw } from "./kitty-adapter";
import { buildKittyGraphicsQuery } from "./kitty-protocol";

interface RendererCapabilities {
  kitty_graphics?: boolean;
}

interface SupportCacheEntry {
  value: boolean | null;
  promise?: Promise<boolean>;
}

const supportCache = new WeakMap<CliRenderer, SupportCacheEntry>();
const QUERY_TIMEOUT_MS = 250;

function readKnownSupport(renderer: CliRenderer): boolean | null {
  const capabilities = renderer.capabilities as RendererCapabilities | null;
  return typeof capabilities?.kitty_graphics === "boolean" ? capabilities.kitty_graphics : null;
}

export function getCachedKittySupport(renderer: CliRenderer): boolean | null {
  const cached = supportCache.get(renderer)?.value ?? null;
  if (cached !== null) return cached;
  return readKnownSupport(renderer);
}

export function ensureKittySupport(renderer: CliRenderer): Promise<boolean> {
  const known = readKnownSupport(renderer);
  if (known !== null) {
    supportCache.set(renderer, { value: known });
    return Promise.resolve(known);
  }

  const cached = supportCache.get(renderer);
  if (cached?.promise) return cached.promise;

  const nextEntry: SupportCacheEntry = { value: null };
  const promise = new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      renderer.off("capabilities", onCapabilities);
      nextEntry.value = value;
      nextEntry.promise = undefined;
      resolve(value);
    };

    const onCapabilities = () => {
      const supported = readKnownSupport(renderer);
      if (supported !== null) finish(supported);
    };

    const timer = setTimeout(() => finish(false), QUERY_TIMEOUT_MS);
    renderer.on("capabilities", onCapabilities);
    if (!writeRendererRaw(renderer, `${buildKittyGraphicsQuery()}\x1b[c`)) {
      finish(false);
      return;
    }
    const supported = readKnownSupport(renderer);
    if (supported !== null) finish(supported);
  });

  nextEntry.promise = promise;
  supportCache.set(renderer, nextEntry);
  return promise;
}

