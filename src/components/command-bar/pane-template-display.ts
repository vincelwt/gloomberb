import type { PaneTemplateDef } from "../../types/plugin";

export function formatPaneTemplateLabel(label: string): string {
  let normalized = label.trim();
  if (normalized.startsWith("New ")) normalized = normalized.slice(4);
  if (normalized.endsWith(" Pane")) normalized = normalized.slice(0, -5);
  return normalized;
}

export function getPaneTemplateDisplayLabel(template: Pick<PaneTemplateDef, "label">): string {
  return formatPaneTemplateLabel(template.label);
}
