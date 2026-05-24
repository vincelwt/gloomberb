import { getFirstVisibleFieldId } from "../helpers";
import type {
  CommandBarFieldValue,
  CommandBarWorkflowField,
  CommandBarWorkflowRoute,
} from "./workflow-types";

export function buildCommandBarWorkflowRoute({
  cancelLabel = "Back",
  description,
  fields,
  payload,
  payloadMeta,
  pendingLabel,
  submitLabel,
  subtitle,
  successBehavior = "close",
  successLabel,
  title,
  values,
  workflowId,
}: {
  workflowId: string;
  title: string;
  subtitle?: string;
  description?: string[];
  fields: CommandBarWorkflowField[];
  values: Record<string, CommandBarFieldValue>;
  submitLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  successLabel?: string;
  successBehavior?: CommandBarWorkflowRoute["successBehavior"];
  payload: CommandBarWorkflowRoute["payload"];
  payloadMeta?: CommandBarWorkflowRoute["payloadMeta"];
}): CommandBarWorkflowRoute {
  return {
    kind: "workflow",
    workflowId,
    title,
    subtitle,
    description,
    fields,
    values,
    activeFieldId: getFirstVisibleFieldId(fields, values),
    submitLabel,
    cancelLabel,
    pendingLabel,
    successLabel,
    pending: false,
    error: null,
    successBehavior,
    payload,
    payloadMeta,
  };
}
