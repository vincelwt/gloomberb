import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { PaneTemplateTextareaStep } from "./pane-template-wizard";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("PaneTemplateTextareaStep", () => {
  test("submits textarea wizard values through the Save action", async () => {
    let resolved = "";

    testSetup = await testRender(
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        <PaneTemplateTextareaStep
          resolve={(value) => { resolved = value; }}
          dialogId="textarea-test"
          step={{
            key: "prompt",
            label: "Screener Prompt",
            type: "textarea",
            placeholder: "Describe the screener...",
            defaultValue: "Find cash-generative semiconductor suppliers",
          }}
        />
      </DialogProvider>,
      { width: 80, height: 16 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame().split("\n");
    const row = frame.findIndex((line) => line.includes("Save"));
    const col = row >= 0 ? frame[row]!.indexOf("Save") : -1;

    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, row);
      await testSetup!.renderOnce();
    });

    expect(resolved).toBe("Find cash-generative semiconductor suppliers");
  });
});
