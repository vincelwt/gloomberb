import { afterEach, expect, test } from "bun:test";
import { act, useRef, useState } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { type TextareaRenderable } from "../../ui";
import { MessageComposer } from "./message-composer";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

test("renders a terminal prefix, focuses on click, types, and submits", async () => {
  let focusRequests = 0;
  let submitted = "";

  function Harness() {
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<TextareaRenderable>(null);

    return (
      <MessageComposer
        inputRef={inputRef}
        initialValue=""
        focused={focused}
        placeholder="Say something..."
        width={32}
        height={1}
        terminalPrefix=" > "
        onFocusRequest={() => {
          focusRequests += 1;
          setFocused(true);
        }}
        keyBindings={[{ name: "return", action: "submit" }]}
        onSubmit={() => {
          submitted = inputRef.current?.editBuffer.getText() ?? "";
        }}
      />
    );
  }

  await act(async () => {
    testSetup = await testRender(<Harness />, { width: 32, height: 3 });
  });

  await act(async () => {
    await testSetup!.renderOnce();
  });

  const initialLines = testSetup.captureCharFrame().split("\n");
  const inputRow = initialLines.findIndex((line) => line.includes("Say something..."));
  const inputCol = initialLines[inputRow]?.indexOf("Say something...") ?? -1;

  expect(inputRow).toBeGreaterThanOrEqual(0);
  expect(inputCol).toBeGreaterThanOrEqual(0);
  expect(initialLines[inputRow]).toContain("> Say something...");

  await act(async () => {
    await testSetup!.mockMouse.click(inputCol + 1, inputRow);
    await testSetup!.renderOnce();
  });

  expect(focusRequests).toBe(1);

  await act(async () => {
    await testSetup!.mockInput.typeText("hello");
    await testSetup!.renderOnce();
  });

  expect(testSetup.captureCharFrame()).toContain("> hello");

  await act(async () => {
    testSetup!.mockInput.pressEnter();
    await testSetup!.renderOnce();
  });

  expect(submitted).toBe("hello");
});
