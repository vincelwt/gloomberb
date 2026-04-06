import { describe, expect, test } from "bun:test";
import { formatPaneTemplateLabel } from "./pane-template-display";

describe("formatPaneTemplateLabel", () => {
  test("removes the redundant new prefix and pane suffix", () => {
    expect(formatPaneTemplateLabel("New Chat Pane")).toBe("Chat");
  });

  test("removes the pane suffix even without the new prefix", () => {
    expect(formatPaneTemplateLabel("Collection Pane")).toBe("Collection");
  });

  test("leaves unrelated labels untouched", () => {
    expect(formatPaneTemplateLabel("Prediction Markets")).toBe("Prediction Markets");
  });
});
