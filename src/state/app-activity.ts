import { CliRenderEvents, type CliRenderer } from "@opentui/core";
import { useSyncExternalStore } from "react";
import { debugLog } from "../utils/debug-log";

const activityLog = debugLog.createLogger("app-activity");

class AppActivityController {
  private active = true;
  private hasSeenFocus = false;
  private boundRenderer: CliRenderer | null = null;
  private teardownRenderer: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  bindRenderer(renderer: CliRenderer): () => void {
    if (this.boundRenderer === renderer && this.teardownRenderer) {
      return this.teardownRenderer;
    }

    this.teardownRenderer?.();
    activityLog.info("bind renderer");

    const handleFocus = () => {
      this.hasSeenFocus = true;
      activityLog.info("focus event");
      this.setActive(true);
    };
    const handleBlur = () => {
      // Some terminals can emit an initial blur before they ever report focus.
      // Fail open until focus reporting has proven itself.
      if (!this.hasSeenFocus) {
        activityLog.warn("ignored blur before first focus");
        return;
      }
      activityLog.info("blur event");
      this.setActive(false);
    };
    const handleDestroy = () => this.reset();

    renderer.on(CliRenderEvents.FOCUS, handleFocus);
    renderer.on(CliRenderEvents.BLUR, handleBlur);
    renderer.on(CliRenderEvents.DESTROY, handleDestroy);

    this.boundRenderer = renderer;
    this.teardownRenderer = () => {
      renderer.off(CliRenderEvents.FOCUS, handleFocus);
      renderer.off(CliRenderEvents.BLUR, handleBlur);
      renderer.off(CliRenderEvents.DESTROY, handleDestroy);
      if (this.boundRenderer === renderer) {
        this.boundRenderer = null;
        this.teardownRenderer = null;
      }
      activityLog.info("unbind renderer");
      this.reset();
    };

    return this.teardownRenderer;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    activityLog.info("activity changed", { active });
    for (const listener of this.listeners) {
      listener();
    }
  }

  reset(): void {
    this.hasSeenFocus = false;
    activityLog.info("reset activity state");
    this.setActive(true);
  }
}

const controller = new AppActivityController();

export function bindAppActivity(renderer: CliRenderer): () => void {
  return controller.bindRenderer(renderer);
}

export function isAppActive(): boolean {
  return controller.isActive();
}

export function setAppActive(active: boolean): void {
  controller.setActive(active);
}

export function useAppActive(): boolean {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.isActive(),
    () => true,
  );
}
