import type { MultiSelectOption } from "../ui/multi-select";
import type {
  CommandBarPickerOption,
  CommandBarWorkflowField,
  CommandBarWorkflowRoute,
} from "./workflow-types";
import { getVisibleWorkflowFields } from "./helpers";

function normalizeWorkflowCopy(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function getWorkflowFieldDescription(field: CommandBarWorkflowField, active: boolean): string | null {
  const description = field.description?.trim();
  if (!description) return null;
  if (normalizeWorkflowCopy(description) === normalizeWorkflowCopy(field.placeholder)) return null;
  return field.type === "textarea" && active ? `${description} Ctrl+S submits.` : description;
}

export function estimateWorkflowBodyRows(route: CommandBarWorkflowRoute): number {
  const visibleFields = getVisibleWorkflowFields(route.fields, route.values);
  const introRows = (route.subtitle ? 1 : 0)
    + (route.description?.length ?? 0)
    + (route.subtitle || (route.description?.length ?? 0) > 0 ? 1 : 0);
  const fieldRows = visibleFields.reduce((total, field, index) => {
    const active = field.id === route.activeFieldId;
    const controlRows = field.type === "textarea" ? 6 : 1;
    const descriptionRows = getWorkflowFieldDescription(field, active) ? 1 : 0;
    const gapRows = index === visibleFields.length - 1 ? 0 : 1;
    return total + 1 + controlRows + descriptionRows + gapRows;
  }, 0);
  const statusRows = (route.error ? 1 : 0) + (route.pending && route.pendingLabel ? 1 : 0);
  return introRows + fieldRows + statusRows + 1;
}

export function toMultiSelectOptions(options: CommandBarPickerOption[]): MultiSelectOption[] {
  return options.map((option) => ({
    value: option.id,
    label: option.label,
    description: option.description,
    disabled: option.disabled,
  }));
}
