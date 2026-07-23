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
  const clearedKeys = new Set<string>();

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

    const activeStep = clearedKeys.has(step.key)
      ? { ...step, defaultValue: undefined }
      : step;
    const result = step.type === "select"
      ? await dialog.prompt<string>({
        content: (ctx: PromptContext<string>) => <PaneTemplateSelectStep {...ctx} step={activeStep} />,
      })
      : step.type === "textarea"
        ? await dialog.prompt<string>({
          content: (ctx: PromptContext<string>) => <PaneTemplateTextareaStep {...ctx} step={activeStep} />,
        })
        : await dialog.prompt<string>({
          content: (ctx: PromptContext<string>) => <PaneTemplateInputStep {...ctx} step={activeStep} />,
        });

    if (result === undefined || ((step.type === "select" || step.type === "textarea") && !result)) {
      return null;
    }

    values[step.key] = result;
    if (!Object.is(result, step.defaultValue ?? "")) {
      for (const key of step.clearOnChange ?? []) clearedKeys.add(key);
    }
  }

  return values;
}
