import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { runPaneTemplateDialogWizard } from "./pane-template-dialog-wizard";

test("changing a sequential wizard selector clears a later default", async () => {
  const defaults: Array<string | undefined> = [];
  const answers = ["codex", ""];
  const dialog = {
    prompt: async ({ content }: { content: (context: unknown) => ReactElement }) => {
      const element = content({});
      defaults.push((element.props as { step?: { defaultValue?: string } }).step?.defaultValue);
      return answers.shift();
    },
  };

  const values = await runPaneTemplateDialogWizard(dialog as never, [{
    key: "providerId",
    label: "Provider",
    type: "select",
    defaultValue: "claude",
    clearOnChange: ["modelId"],
    options: [
      { label: "Claude", value: "claude" },
      { label: "OpenAI", value: "codex" },
    ],
  }, {
    key: "modelId",
    label: "Model",
    type: "text",
    required: false,
    defaultValue: "claude-opus-4-8",
  }]);

  expect(defaults).toEqual(["claude", undefined]);
  expect(values).toEqual({ providerId: "codex", modelId: "" });
});
