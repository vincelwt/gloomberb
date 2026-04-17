
export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function normalizeMultiSelectValues(
  options: readonly MultiSelectOption[],
  values: readonly string[],
): string[] {
  const knownValues = new Set(options.map((option) => option.value));
  return [
    ...options
      .map((option) => option.value)
      .filter((optionValue) => values.includes(optionValue)),
    ...values.filter((optionValue) => !knownValues.has(optionValue)),
  ];
}

export function toggleMultiSelectValue(
  options: readonly MultiSelectOption[],
  selectedValues: readonly string[],
  value: string,
): string[] {
  const nextSelected = new Set(selectedValues);
  if (nextSelected.has(value)) {
    nextSelected.delete(value);
  } else {
    nextSelected.add(value);
  }

  return normalizeMultiSelectValues(options, [...nextSelected]);
}

export function moveMultiSelectValue(
  options: readonly MultiSelectOption[],
  selectedValues: readonly string[],
  selectedOption: string,
  direction: "up" | "down",
): string[] {
  if (!selectedValues.includes(selectedOption)) return [...selectedValues];

  const optionValueSet = new Set(options.map((option) => option.value));
  const ordered = selectedValues.filter((value) => optionValueSet.has(value));
  const index = ordered.indexOf(selectedOption);
  if (index < 0) return [...selectedValues];

  const targetIndex = direction === "up"
    ? Math.max(0, index - 1)
    : Math.min(ordered.length - 1, index + 1);
  if (targetIndex === index) return [...selectedValues];

  const next = [...ordered];
  const [entry] = next.splice(index, 1);
  next.splice(targetIndex, 0, entry!);
  const unknownValues = selectedValues.filter((value) => !optionValueSet.has(value));
  return [...next, ...unknownValues];
}

export function summarizeMultiSelectValues({
  options,
  selectedValues,
  emptyLabel = "None",
  maxLabels = 2,
}: {
  options: readonly MultiSelectOption[];
  selectedValues: readonly string[];
  emptyLabel?: string;
  maxLabels?: number;
}): string {
  const selectedLabels = selectedValues
    .map((selectedValue) => options.find((option) => option.value === selectedValue)?.label ?? selectedValue);

  if (selectedLabels.length === 0) return emptyLabel;
  if (selectedLabels.length <= maxLabels) return selectedLabels.join(", ");
  return `${selectedLabels.length} selected`;
}
