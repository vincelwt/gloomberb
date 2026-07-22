import { describe, expect, test } from "bun:test";
import { displayWidth } from "../../../utils/format";
import { getLanguage, setLanguage, t } from "../../../i18n";
import { actionMenuWidth } from "./menu";

describe("action menu sizing", () => {
  test("uses translated terminal display width", () => {
    const previousLanguage = getLanguage();
    try {
      setLanguage("ja");
      const translatedWidth = displayWidth(t("Dock Pane")) + 2;

      expect(actionMenuWidth([{ label: "Dock Pane" }], 44)).toBe(translatedWidth);
      expect(translatedWidth).toBeGreaterThan(18);
    } finally {
      setLanguage(previousLanguage);
    }
  });
});
