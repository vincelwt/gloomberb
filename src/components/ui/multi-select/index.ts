
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

export function normalizeOrderedMultiSelectValues(
  options: readonly MultiSelectOption[],
  values: readonly string[],
): string[] {
  const knownValues = new Set(options.map((option) => option.value));
  const seen = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (knownValues.has(value)) nextValues.push(value);
  }

  for (const value of values) {
    if (!knownValues.has(value) && !nextValues.includes(value)) {
      nextValues.push(value);
    }
  }

  return nextValues;
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

export function toggleOrderedMultiSelectValue(
  options: readonly MultiSelectOption[],
  selectedValues: readonly string[],
  value: string,
): string[] {
  const knownValues = new Set(options.map((option) => option.value));
  const normalized = normalizeOrderedMultiSelectValues(options, selectedValues);
  if (normalized.includes(value)) {
    return normalized.filter((entry) => entry !== value);
  }

  const knownSelected = normalized.filter((entry) => knownValues.has(entry));
  const unknownSelected = normalized.filter((entry) => !knownValues.has(entry));
  return [...knownSelected, value, ...unknownSelected];
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

export function getMultiSelectDisplayValues(
  options: readonly MultiSelectOption[],
  selectedValues: readonly string[],
  ordered: boolean,
): string[] {
  const optionValues = options.map((option) => option.value);
  if (!ordered) return optionValues;

  const selectedQueue = normalizeOrderedMultiSelectValues(options, selectedValues);
  const selectedValueSet = new Set(selectedQueue);
  const displayValues: string[] = [];

  for (const option of options) {
    if (selectedValueSet.has(option.value)) {
      displayValues.push(selectedQueue.shift() ?? option.value);
    } else {
      displayValues.push(option.value);
    }
  }

  return displayValues;
}

export function mergeMultiSelectDisplayValues(
  options: readonly MultiSelectOption[],
  displayValues: readonly string[],
): string[] {
  const optionValues = options.map((option) => option.value);
  const optionValueSet = new Set(optionValues);
  const nextValues = displayValues.filter((value) => optionValueSet.has(value));
  const nextValueSet = new Set(nextValues);
  return [
    ...nextValues,
    ...optionValues.filter((value) => !nextValueSet.has(value)),
  ];
}

export function orderMultiSelectOptionsForDisplay(
  options: readonly MultiSelectOption[],
  displayValues: readonly string[],
): MultiSelectOption[] {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  return mergeMultiSelectDisplayValues(options, displayValues)
    .map((value) => optionByValue.get(value))
    .filter((option): option is MultiSelectOption => option != null);
}

export function moveMultiSelectDisplayValue(
  displayValues: readonly string[],
  selectedValues: readonly string[],
  selectedOption: string,
  direction: "up" | "down",
): string[] {
  const selectedIndex = selectedValues.indexOf(selectedOption);
  if (selectedIndex < 0) return [...displayValues];

  const targetIndex = direction === "up"
    ? Math.max(0, selectedIndex - 1)
    : Math.min(selectedValues.length - 1, selectedIndex + 1);
  if (targetIndex === selectedIndex) return [...displayValues];

  const targetOption = selectedValues[targetIndex];
  const sourceDisplayIndex = displayValues.indexOf(selectedOption);
  const targetDisplayIndex = targetOption ? displayValues.indexOf(targetOption) : -1;
  if (sourceDisplayIndex < 0 || targetDisplayIndex < 0) return [...displayValues];

  const nextDisplayValues = [...displayValues];
  nextDisplayValues[sourceDisplayIndex] = targetOption!;
  nextDisplayValues[targetDisplayIndex] = selectedOption;
  return nextDisplayValues;
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
