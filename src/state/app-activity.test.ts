import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import { CliRenderEvents } from "@opentui/core";
import { bindAppActivity, isAppActive, setAppActive } from "./app-activity";

afterEach(() => {
  setAppActive(true);
});

describe("app activity", () => {
  test("ignores blur until focus reporting has been established", () => {
    const renderer = new EventEmitter() as any;
    const unbind = bindAppActivity(renderer);

    renderer.emit(CliRenderEvents.BLUR);
    expect(isAppActive()).toBe(true);

    renderer.emit(CliRenderEvents.FOCUS);
    renderer.emit(CliRenderEvents.BLUR);
    expect(isAppActive()).toBe(false);

    unbind();
  });

  test("tracks renderer focus state", () => {
    const renderer = new EventEmitter() as any;
    const unbind = bindAppActivity(renderer);

    expect(isAppActive()).toBe(true);

    renderer.emit(CliRenderEvents.FOCUS);
    renderer.emit(CliRenderEvents.BLUR);
    expect(isAppActive()).toBe(false);

    renderer.emit(CliRenderEvents.FOCUS);
    expect(isAppActive()).toBe(true);

    unbind();
    expect(isAppActive()).toBe(true);
  });
});
