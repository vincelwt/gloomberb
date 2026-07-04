import { type ReactNode } from "react";
import { Checkbox, TextField } from "../../../components";
import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import type { AccountFieldKey, ProfileAnalyticsPreview } from "./model";
import { truncate } from "./model";

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
  return (
    <Box onMouseDown={() => onFocus(fieldKey)}>
      <TextField
        label={`${active ? "> " : "  "}${label}`}
        value={value}
        placeholder={placeholder}
        focused={focused && active}
        width={width}
        type={type}
        onChange={onChange}
        onSubmit={onSubmit}
        onMouseDown={() => onFocus(fieldKey)}
      />
    </Box>
  );
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

export function PickerRow({
  label,
  value,
  detail,
  active,
  width,
  onFocus,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
  active: boolean;
  width: number;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const buttonWidth = Math.max(12, Math.min(32, width - 18));
  const detailWidth = Math.max(0, width - buttonWidth - 4);

  return (
    <Box
      flexDirection="column"
      onMouseOver={onFocus}
      onMouseDown={(event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        onFocus();
        onOpen();
      }}
    >
      <Text fg={active ? colors.textBright : colors.textDim} attributes={active ? TextAttributes.BOLD : 0}>
        {active ? `> ${label}` : `  ${label}`}
      </Text>
      <Box height={1} flexDirection="row" gap={1}>
        <Box width={buttonWidth} backgroundColor={active ? colors.selected : colors.panel}>
          <Text fg={active ? colors.selectedText : colors.text}>
            {` ${truncate(value, Math.max(1, buttonWidth - 2))} `}
          </Text>
        </Box>
        {detail ? (
          <Text fg={colors.textMuted}>{truncate(detail, detailWidth)}</Text>
        ) : null}
      </Box>
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
  return (
    <Box onMouseOver={onFocus}>
      <Checkbox
        label={label}
        checked={checked}
        active={active}
        description={description}
        width={width}
        variant="desktop"
        onChange={(nextChecked) => {
          onFocus();
          onChange(nextChecked);
        }}
      />
    </Box>
  );
}

function metricColor(tone: ProfileAnalyticsPreview["metrics"][number]["tone"]): string {
  if (tone === "positive") return colors.positive;
  if (tone === "negative") return colors.negative;
  if (tone === "muted") return colors.textMuted;
  return colors.text;
}

export function AccountAnalyticsPreview({
  preview,
  width,
  disclaimer,
  surface = "panel",
}: {
  preview: ProfileAnalyticsPreview;
  width: number;
  disclaimer?: string | null;
  surface?: "panel" | "plain";
}) {
  const horizontalPadding = surface === "panel" ? 1 : 0;
  const contentWidth = Math.max(1, width - horizontalPadding * 2);
  const metricWidth = Math.max(14, Math.min(28, Math.floor((contentWidth - 2) / 2)));
  const subtitleWidth = Math.max(1, contentWidth - preview.title.length - 2);
  const showHeader = surface === "panel";

  return (
    <Box
      flexDirection="column"
      width={width}
      backgroundColor={surface === "panel" ? colors.panel : undefined}
      paddingX={horizontalPadding}
    >
      {showHeader ? (
        <Box height={1} flexDirection="row">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {truncate(preview.title, contentWidth)}
          </Text>
          {preview.subtitle ? (
            <>
              <Box flexGrow={1} />
              <Text fg={colors.textMuted}>{truncate(preview.subtitle, subtitleWidth)}</Text>
            </>
          ) : null}
        </Box>
      ) : null}
      {preview.metrics.length > 0 ? (
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          {preview.metrics.map((metric) => {
            const labelWidth = Math.max(1, Math.min(metric.label.length, metricWidth - 2));
            const valueWidth = Math.max(1, metricWidth - labelWidth - 1);
            const detailWidth = Math.max(0, metricWidth - labelWidth - metric.value.length - 2);
            return (
              <Box key={metric.id} width={metricWidth} height={1} flexDirection="row" gap={1}>
                <Text fg={colors.textDim}>{truncate(metric.label, labelWidth)}</Text>
                <Text fg={metricColor(metric.tone)} attributes={TextAttributes.BOLD}>
                  {truncate(metric.value, valueWidth)}
                </Text>
                {metric.detail ? (
                  <Text fg={colors.textMuted}>
                    {truncate(metric.detail, detailWidth)}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : preview.subtitle ? (
        <Text fg={colors.textMuted} wrapText width={contentWidth}>
          {preview.subtitle}
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

export function PublicAnalyticsGroup({
  preview,
  label,
  detail,
  active,
  width,
  disclaimer,
  onFocus,
  onOpen,
}: {
  preview: ProfileAnalyticsPreview;
  label: string;
  detail?: string;
  active: boolean;
  width: number;
  disclaimer?: string | null;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const contentWidth = Math.max(1, width - 2);
  const buttonWidth = Math.max(12, Math.min(34, Math.floor(contentWidth * 0.44)));
  const detailWidth = Math.max(0, contentWidth - buttonWidth - 12);
  const normalizedDetail = (detail ?? "").replace(/\.+$/, "");
  const displayPreview = (
    preview.metrics.length === 0
    && normalizedDetail
    && preview.subtitle.replace(/\.+$/, "") === normalizedDetail
  ) ? { ...preview, subtitle: "" } : preview;
  return (
    <Box
      flexDirection="column"
      width={width}
      backgroundColor={colors.panel}
      paddingX={1}
      onMouseOver={onFocus}
    >
      <Box height={1} flexDirection="row" gap={1}>
        <Text fg={active ? colors.textBright : colors.textDim} attributes={active ? TextAttributes.BOLD : 0}>
          {active ? "> Analytics" : "  Analytics"}
        </Text>
        <Box
          width={buttonWidth}
          backgroundColor={active ? colors.selected : colors.bg}
          onMouseDown={(event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            onFocus();
            onOpen();
          }}
        >
          <Text fg={active ? colors.selectedText : colors.text}>
            {` ${truncate(label, Math.max(1, buttonWidth - 2))} `}
          </Text>
        </Box>
        {detail ? (
          <Text fg={colors.textMuted}>
            {truncate(detail, detailWidth)}
          </Text>
        ) : null}
      </Box>
      <AccountAnalyticsPreview
        preview={displayPreview}
        width={contentWidth}
        disclaimer={disclaimer}
        surface="plain"
      />
    </Box>
  );
}
