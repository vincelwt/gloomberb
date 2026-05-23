import type { BrokerConfigField } from "../../../types/broker";
import type { ListViewItem } from "../../ui";

const PASSWORD_MASK_CHAR = "*";

export function getBrokerLabel(choices: ListViewItem[], selectedBrokerId: string): string {
  return choices.find((choice) => choice.id === selectedBrokerId)?.label.replace("Connect ", "") ?? selectedBrokerId;
}

export function formatBrokerFieldValue(field: BrokerConfigField, value: string): string {
  if (field.type === "select") {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  return field.type === "password" ? PASSWORD_MASK_CHAR.repeat(value.length) : value;
}
