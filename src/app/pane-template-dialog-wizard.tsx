import {
  PaneTemplateInfoStep,
  PaneTemplateInputStep,
  PaneTemplateSelectStep,
  PaneTemplateTextareaStep,
} from "../components/pane-template-wizard";
import type {
  AlertContext,
  DialogApi,
  PromptContext,
} from "../ui/dialog";
import type { WizardStep } from "../types/plugin";

export async function runPaneTemplateDialogWizard(
  dialog: DialogApi,
  steps: WizardStep[],
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};

  for (const step of steps) {
    if (step.dependsOn && values[step.dependsOn.key] !== step.dependsOn.value) {
      continue;
    }

    if (step.type === "info") {
      await dialog.alert({
        content: (ctx: AlertContext) => <PaneTemplateInfoStep {...ctx} step={step} />,
      });
      continue;
    }

    const result = step.type === "select"
      ? await dialog.prompt<string>({
        content: (ctx: PromptContext<string>) => <PaneTemplateSelectStep {...ctx} step={step} />,
      })
      : step.type === "textarea"
        ? await dialog.prompt<string>({
          content: (ctx: PromptContext<string>) => <PaneTemplateTextareaStep {...ctx} step={step} />,
        })
        : await dialog.prompt<string>({
          content: (ctx: PromptContext<string>) => <PaneTemplateInputStep {...ctx} step={step} />,
        });

    if (result === undefined || ((step.type === "select" || step.type === "textarea") && !result)) {
      return null;
    }

    values[step.key] = result;
  }

  return values;
}
