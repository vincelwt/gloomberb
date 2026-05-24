import type {
  PaneTemplateDef,
} from "../../../types/plugin";
import {
  buildGeneratedTemplateField,
  normalizeWizardFields,
} from "../helpers";
import type {
  CommandBarFieldValue,
  CommandBarWorkflowField,
  CommandBarWorkflowRoute,
} from "../workflow/workflow-types";
import { buildCommandBarWorkflowRoute } from "../workflow/workflow-route-builder";
import {
  canPromptForPaneTemplateArg,
  getPaneTemplateDisplayLabel,
} from "./pane-template-items";

export function shouldOpenPaneTemplateConfig(template: PaneTemplateDef, arg?: string): boolean {
  if (template.wizard && template.wizard.length > 0) {
    if (!arg?.trim()) {
      return true;
    }
    const argPlaceholder = template.shortcut?.argPlaceholder;
    return template.wizard.some((step) => step.type === "textarea" || step.key !== argPlaceholder);
  }
  if (canPromptForPaneTemplateArg(template)) {
    return !arg?.trim();
  }
  return false;
}

export function buildPaneTemplateWorkflowRoute({
  activeTicker,
  arg,
  template,
}: {
  activeTicker: string | null;
  arg?: string;
  template: PaneTemplateDef;
}): CommandBarWorkflowRoute {
  const displayLabel = getPaneTemplateDisplayLabel(template);
  const normalized: ReturnType<typeof normalizeWizardFields> = template.wizard && template.wizard.length > 0
    ? normalizeWizardFields(template.wizard)
    : { fields: [] as CommandBarWorkflowField[], description: [] as string[], initialValues: {} as Record<string, CommandBarFieldValue> };
  const generated = buildGeneratedTemplateField(template, activeTicker);

  const fields = [...normalized.fields];
  const values: Record<string, CommandBarFieldValue> = { ...normalized.initialValues };
  if (generated.field && !fields.some((field) => field.id === generated.field!.id)) {
    fields.push(generated.field);
    if (generated.initialValue !== undefined) {
      values[generated.field.id] = generated.initialValue;
    }
  }
  if (arg && template.shortcut?.argPlaceholder) {
    values[template.shortcut.argPlaceholder] = arg;
  }

  return buildCommandBarWorkflowRoute({
    workflowId: `pane-template:${template.id}`,
    title: displayLabel,
    subtitle: template.description,
    description: normalized.description,
    fields,
    values,
    submitLabel: "Create Pane",
    pendingLabel: normalized.pendingLabel ?? `Creating ${displayLabel.toLowerCase()}...`,
    successLabel: normalized.successLabel,
    payload: {
      kind: "pane-template",
      actionId: template.id,
    },
    payloadMeta: {
      argPlaceholder: template.shortcut?.argPlaceholder,
    },
  });
}
