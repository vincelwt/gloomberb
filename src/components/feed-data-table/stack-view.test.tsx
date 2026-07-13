import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { Box, Text } from "../../ui";
import { FeedDataTableStackView } from "./stack-view";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await act(async () => testSetup?.renderer.destroy());
  testSetup = undefined;
});

test("delegates root key handling", async () => {
  let keyHits = 0;
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-feed-table-test"));
  await act(async () => {
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="portfolio-list:main">
          <FeedDataTableStackView
            width={80}
            height={12}
            focused
            items={[]}
            selectedIdx={0}
            onSelect={() => {}}
            rootBefore={<Box height={1}><Text>Feed controls</Text></Box>}
            onRootKeyDown={(event) => {
              if (event.name !== "f") return false;
              keyHits += 1;
              return true;
            }}
          />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 80, height: 12 },
    );
    await testSetup.renderOnce();
  });

  await act(async () => {
    (testSetup!.renderer.keyInput as any).emit("keypress", {
      name: "f", sequence: "f", eventType: "press",
      ctrl: false, meta: false, option: false, shift: false, repeated: false,
      preventDefault() {}, stopPropagation() {},
    });
    await testSetup!.renderOnce();
  });

  expect(keyHits).toBe(1);
});
