import type { PaneTemplateDef } from "../../types/plugin";

export function getPaneTemplateDisplayLabel(template: Pick<PaneTemplateDef, "label">): string {
  let label = template.label.trim();
  if (label.startsWith("New ")) label = label.slice(4);
  if (label.endsWith(" Pane")) label = label.slice(0, -5);
  return label;
}
