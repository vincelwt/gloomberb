import { type ReactNode } from "react";
import { Button, Checkbox, TextField, type ChoiceDialogChoice } from "../../../components";
import { Box, Text, TextAttributes, useUiHost } from "../../../ui";
import { colors } from "../../../theme/colors";
import { NativeSelect, type NativeSelectElement } from "../../../components/ui/native-select";
import type { AccountFieldKey, ProfileAnalyticsPreview } from "./model";
import { truncate } from "./model";
import { t } from "../../../i18n";

export function AccountTextField({
  fieldKey,
  label,
  value,
  placeholder,
  activeField,
  focused,
  width,
  type,
  onFocus,
  onChange,
  onSubmit,
}: {
  fieldKey: AccountFieldKey;
  label: string;
  value: string;
  placeholder?: string;
  activeField: AccountFieldKey;
  focused: boolean;
  width: number;
  type?: "text" | "password";
  onFocus: (field: AccountFieldKey) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const active = activeField === fieldKey;
  const labelWidth = accountFieldLabelWidth(width);
  const inputWidth = Math.max(8, width - labelWidth - 1);
  const labelText = `${active ? "> " : "  "}${label}`;
  return (
    <Box
      height={1}
      width={width}
      flexDirection="row"
      alignItems="center"
      gap={1}
      onMouseDown={() => onFocus(fieldKey)}
    >
      <Text
        width={labelWidth}
        fg={active ? colors.textBright : colors.textDim}
        attributes={active ? TextAttributes.BOLD : 0}
      >
        {truncate(labelText, labelWidth)}
      </Text>
      <TextField
        value={value}
        placeholder={placeholder}
        focused={focused && active}
        width={inputWidth}
        type={type}
        onChange={onChange}
        onSubmit={onSubmit}
        onMouseDown={() => onFocus(fieldKey)}
      />
    </Box>
  );
}

export function accountFieldLabelWidth(width: number) {
  const preferred = width >= 28 ? 16 : Math.max(10, Math.floor(width * 0.42));
  return Math.max(8, Math.min(preferred, width - 9));
}

export function FieldRow({
  twoColumns,
  children,
}: {
  twoColumns: boolean;
  children: ReactNode;
}) {
  return (
    <Box flexDirection={twoColumns ? "row" : "column"} gap={1}>
      {children}
    </Box>
  );
}

export function CheckboxRow({
  label,
  checked,
  active,
  description,
  width,
  onFocus,
  onChange,
}: {
  label: string;
  checked: boolean;
  active: boolean;
  description?: string;
  width: number;
  onFocus: () => void;
  onChange: (checked: boolean) => void;
}) {
  const labelText = `${active ? "> " : "  "}${label}`;
  const labelWidth = Math.min(
    width - 9,
    Math.max(accountFieldLabelWidth(width), Math.min(labelText.length, 34)),
  );
  const controlWidth = Math.max(8, width - labelWidth - 1);
  return (
    <Box
      flexDirection="column"
      width={width}
      onMouseOver={onFocus}
      onMouseDown={(event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        onFocus();
        onChange(!checked);
      }}
    >
      <Box height={1} flexDirection="row" alignItems="center" gap={1}>
        <Text
          width={labelWidth}
          fg={active ? colors.textBright : colors.textDim}
          attributes={active ? TextAttributes.BOLD : 0}
        >
          {truncate(labelText, labelWidth)}
        </Text>
        <Checkbox
          label={label}
          displayLabel={checked ? t("On") : t("Off")}
          checked={checked}
          active={false}
          width={controlWidth}
          variant="desktop"
          onChange={(nextChecked) => {
            onFocus();
            onChange(nextChecked);
          }}
        />
      </Box>
      {description ? (
        <Box height={1} flexDirection="row" gap={1}>
          <Box width={labelWidth} />
          <Text fg={colors.textMuted} wrapText width={controlWidth}>
            {description}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function metricColor(tone: ProfileAnalyticsPreview["metrics"][number]["tone"]): string {
  if (tone === "positive") return colors.positive;
  if (tone === "negative") return colors.negative;
  if (tone === "muted") return colors.textMuted;
  return colors.text;
}

export function PublicAnalyticsGroup({
  preview,
  choices,
  value,
  label,
  detail,
  active,
  width,
  disclaimer,
  selectRef,
  onFocus,
  onSelect,
  onOpen,
}: {
  preview: ProfileAnalyticsPreview;
  choices: ChoiceDialogChoice[];
  value: string;
  label: string;
  detail?: string;
  active: boolean;
  width: number;
  disclaimer?: string | null;
  selectRef?: (element: NativeSelectElement | null) => void;
  onFocus: () => void;
  onSelect: (value: string) => void;
  onOpen: () => void;
}) {
  const isDesktop = useUiHost().kind === "desktop-web";
  const contentWidth = Math.max(1, width - 2);
  const labelText = active ? `> ${t("Public Stats:")}` : `  ${t("Public Stats:")}`;
  const labelWidth = Math.min(accountFieldLabelWidth(width), Math.max(1, contentWidth));
  const nativeButtonWidth = Math.max(14, Math.min(24, Math.floor(contentWidth * 0.3)));
  const terminalMaxButtonWidth = Math.max(8, Math.min(24, contentWidth - labelWidth - 1));
  const buttonLabel = truncate(label, Math.max(1, terminalMaxButtonWidth - 4));
  const buttonWidth = buttonLabel.length + 4;
  const layoutButtonWidth = isDesktop ? nativeButtonWidth : buttonWidth;
  const nativeSelectWidth = nativeButtonWidth * 8;
  const normalizedDetail = (detail ?? "").replace(/\.+$/, "");
  const displayPreview = (
    preview.metrics.length === 0
    && normalizedDetail
    && preview.subtitle.replace(/\.+$/, "") === normalizedDetail
  ) ? { ...preview, subtitle: "" } : preview;
  const metrics = displayPreview.metrics.slice(0, 2);
  const metricAreaWidth = Math.max(0, contentWidth - labelWidth - layoutButtonWidth - 2);
  const metricWidth = metrics.length > 0 ? Math.max(8, Math.floor((metricAreaWidth - (metrics.length - 1)) / metrics.length)) : 0;
  const detailWidth = Math.max(0, metricAreaWidth);
  return (
    <Box
      flexDirection="column"
      width={width}
      onMouseOver={onFocus}
    >
      <Box height={isDesktop ? "24px" : 1} flexDirection="row" gap={1} alignItems="center">
        <Text fg={active ? colors.textBright : colors.textDim} attributes={active ? TextAttributes.BOLD : 0}>
          {truncate(labelText, labelWidth)}
        </Text>
        {isDesktop ? (
          <NativeSelect
            value={value}
            options={choices.map((choice) => ({
              value: choice.id,
              label: choice.label,
              disabled: choice.disabled,
            }))}
            width={nativeSelectWidth}
            height={22}
            selectRef={selectRef}
            onFocus={onFocus}
            onChange={onSelect}
          />
        ) : (
          <Button
            label={`${buttonLabel} v`}
            variant="secondary"
            width={buttonWidth}
            active={active}
            onPress={() => {
              onFocus();
              onOpen();
            }}
          />
        )}
        {metrics.length > 0 ? metrics.map((metric) => {
          const labelTextWidth = Math.max(1, Math.min(metric.label.length, metricWidth - 2));
          const valueWidth = Math.max(1, metricWidth - labelTextWidth - 1);
          return (
            <Box key={metric.id} width={metricWidth} height={1} flexDirection="row" gap={1}>
              <Text fg={colors.textDim}>{truncate(metric.label, labelTextWidth)}</Text>
              <Text fg={metricColor(metric.tone)} attributes={TextAttributes.BOLD}>
                {truncate(metric.value, valueWidth)}
              </Text>
            </Box>
          );
        }) : detail ? (
          <Text fg={colors.textMuted}>
            {truncate(detail, detailWidth)}
          </Text>
        ) : null}
      </Box>
      {metrics.length === 0 && displayPreview.subtitle ? (
        <Text fg={colors.textMuted} wrapText width={contentWidth}>
          {displayPreview.subtitle}
        </Text>
      ) : null}
      {disclaimer ? (
        <Text fg={colors.textMuted} wrapText width={contentWidth}>
          {disclaimer}
        </Text>
      ) : null}
    </Box>
  );
}
