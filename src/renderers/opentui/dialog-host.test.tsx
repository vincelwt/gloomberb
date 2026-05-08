import { afterEach, expect, test } from "bun:test";
import { act, useEffect, useState } from "react";
import { useDialog } from "../../ui/dialog";
import { testRender } from "./test-utils";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function NestedDialogContent() {
  useDialog();
  return <text>Nested dialog context works</text>;
}

function DialogProbe() {
  const dialog = useDialog();
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (opened) return;
    setOpened(true);
    void dialog.alert({
      content: () => <NestedDialogContent />,
    });
  }, [dialog, opened]);

  return <text>Dialog probe</text>;
}

test("provides dialog context to OpenTUI dialog content", async () => {
  testSetup = await testRender(<DialogProbe />, { width: 80, height: 16 });

  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });

  expect(testSetup.captureCharFrame()).toContain("Nested dialog context works");
});
