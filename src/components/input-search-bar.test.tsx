import { afterEach, describe, expect, test } from "bun:test";
import { act, useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { AppContext, createInitialState, type AppAction } from "../state/app/context";
import { createDefaultConfig } from "../types/config";
import type { InputRenderable } from "../ui";
import { InputSearchBar } from "./input-search-bar";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setSearchActive: Dispatch<SetStateAction<boolean>> | null = null;

afterEach(async () => {
  setSearchActive = null;
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function Harness({ actions }: { actions: AppAction[] }) {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-input-search-bar"));
  const inputRef = useRef<InputRenderable | null>(null);
  const [active, setActive] = useState(true);
  setSearchActive = setActive;
  const dispatch = useCallback((action: AppAction) => {
    actions.push(action);
  }, [actions]);

  return (
    <AppContext value={{ state, dispatch }}>
      <InputSearchBar
        value=""
        focused
        active={active}
        width={30}
        focusToken={0}
        inputRef={inputRef}
        placeholder="search"
        debounceMs={100}
        onFocus={() => {}}
        onBlur={() => {}}
        onQueryChange={() => {}}
      />
    </AppContext>
  );
}

describe("InputSearchBar", () => {
  test("captures app input while the search input is active", async () => {
    const actions: AppAction[] = [];

    testSetup = await testRender(<Harness actions={actions} />, { width: 40, height: 4 });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    expect(actions).toEqual([{ type: "SET_INPUT_CAPTURED", captured: true }]);
    if (!setSearchActive) throw new Error("search setter was not registered");

    await act(async () => {
      setSearchActive(false);
      await testSetup!.renderOnce();
    });

    expect(actions).toEqual([
      { type: "SET_INPUT_CAPTURED", captured: true },
      { type: "SET_INPUT_CAPTURED", captured: false },
    ]);
  });
});
