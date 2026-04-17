import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { Box } from "../../ui";
import { testRender } from "../../renderers/opentui/test-utils";
import {
  PaneFooterBar,
  PaneFooterProvider,
  usePaneFooter,
} from "./pane-footer";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

function Registration({
  visible = true,
  onRefresh,
}: {
  visible?: boolean;
  onRefresh?: () => void;
}) {
  usePaneFooter("test", () => {
    if (!visible) return null;
    return {
      info: [
        {
          id: "rows",
          parts: [
            { text: "Rows", tone: "label" },
            { text: "12", tone: "value", bold: true },
          ],
        },
      ],
      hints: [
        { id: "refresh", key: "r", label: "efresh", onPress: onRefresh },
      ],
    };
  }, [onRefresh, visible]);
  return null;
}

function FooterHarness({
  focused = false,
  visible = true,
  onRefresh,
}: {
  focused?: boolean;
  visible?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <PaneFooterProvider>
      {(footer) => (
        <Box width={64} height={1}>
          <Registration visible={visible} onRefresh={onRefresh} />
          <PaneFooterBar footer={footer} focused={focused} width={64} />
        </Box>
      )}
    </PaneFooterProvider>
  );
}

describe("PaneFooterBar", () => {
  test("renders info left and hints right", async () => {
    testSetup = await testRender(<FooterHarness />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Rows 12");
    expect(frame).toContain("[r]efresh");
  });

  test("calls hint onPress from mouse interaction", async () => {
    let refreshCount = 0;
    testSetup = await testRender(<FooterHarness onRefresh={() => { refreshCount += 1; }} />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const line = testSetup.captureCharFrame().split("\n")[0] ?? "";
    const col = line.indexOf("[r]efresh");
    expect(col).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(col + 1, 0);
      await testSetup!.renderOnce();
    });
    expect(refreshCount).toBe(1);
  });

  test("keeps focused border from hiding content", async () => {
    testSetup = await testRender(<FooterHarness focused />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("└");
    expect(frame).toContain("┘");
    expect(frame).toContain("Rows 12");
    expect(frame).toContain("[r]efresh");
  });

  test("clears a registration when the component unmounts", async () => {
    testSetup = await testRender(<FooterHarness visible={false} />, { width: 64, height: 1 });
    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("Rows 12");
    expect(frame).not.toContain("[r]efresh");
  });
});
