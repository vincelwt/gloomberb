import { Box, Text, useUiHost } from "../ui";
import { TextAttributes } from "../ui";
import { type AlertContext, useDialog, useDialogKeyboard } from "../ui/dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  PaneSettingField,
  PaneSettingTextField,
} from "../types/plugin";
import type { PluginRegistry } from "../plugins/registry";
import { colors } from "../theme/colors";
import { Button, DialogFrame, ListView, MultiSelectDialogContent, SegmentedControl, TextField } from "./ui";

interface PaneSettingsDialogContentProps extends AlertContext {
  paneId: string;
  pluginRegistry: PluginRegistry;
  applyFieldValue: (paneId: string, field: PaneSettingField, value: unknown) => Promise<void>;
}

type SelectPaneSettingField = Extract<PaneSettingField, { type: "select" }>;
type MultiSelectPaneSettingField = Extract<PaneSettingField, { type: "multi-select" | "ordered-multi-select" }>;

interface SelectFieldDialogProps extends AlertContext {
  field: SelectPaneSettingField;
  currentValue: unknown;
  onApply: (value: string) => Promise<void>;
}

interface TextFieldDialogProps extends AlertContext {
  field: PaneSettingTextField;
  currentValue: unknown;
  onApply: (value: string) => Promise<void>;
}

function isSpaceKey(event: { name?: string; sequence?: string }): boolean {
  return event.name === "space" || event.name === " " || event.sequence === " ";
}

function summarizeValue(field: PaneSettingField, value: unknown): string {
  switch (field.type) {
    case "toggle":
      return value === true ? "On" : "Off";
    case "text":
      return typeof value === "string" && value.trim().length > 0 ? value : "Unset";
    case "select": {
      const option = field.options.find((entry) => entry.value === value);
      return option?.label ?? "Unset";
    }
    case "multi-select":
    case "ordered-multi-select": {
      const selectedValues = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (selectedValues.length === 0) return "None";
      const labels = selectedValues
        .map((selectedValue) => field.options.find((entry) => entry.value === selectedValue)?.label ?? selectedValue)
        .slice(0, 3);
      const suffix = selectedValues.length > 3 ? ` +${selectedValues.length - 3}` : "";
      return `${labels.join(", ")}${suffix}`;
    }
    default:
      return "";
  }
}

function coerceSelectedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

const DESKTOP_TEXT_STYLE = {
  letterSpacing: 0,
  lineHeight: "var(--cell-h)",
} as const;

function desktopText(weight?: number) {
  return weight ? { ...DESKTOP_TEXT_STYLE, fontWeight: weight } : DESKTOP_TEXT_STYLE;
}

function DesktopDialogSurface({
  title,
  subtitle,
  dismiss,
  children,
}: {
  title: string;
  subtitle?: string;
  dismiss: () => void;
  children: ReactNode;
}) {
  return (
    <Box
      width={68}
      maxWidth="calc(100vw - 72px)"
      flexDirection="column"
      style={{
        padding: 12,
      }}
    >
      <Box flexDirection="row" alignItems="flex-start" style={{ marginBottom: 10 }}>
        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          <Text fg={colors.textBright} style={desktopText(700)}>{title}</Text>
          {subtitle && (
            <Text fg={colors.textMuted} wrapText style={{ ...desktopText(), marginTop: 3 }}>
              {subtitle}
            </Text>
          )}
        </Box>
        <Box
          width={3}
          height={1}
          alignItems="center"
          justifyContent="center"
          onMouseDown={(event: any) => {
            event.stopPropagation?.();
            event.preventDefault?.();
            dismiss();
          }}
          data-gloom-interactive="true"
          style={{
            borderRadius: 6,
            cursor: "pointer",
            marginLeft: 16,
            color: colors.textMuted,
          }}
        >
          <Text fg={colors.textMuted} style={desktopText(700)}>x</Text>
        </Box>
      </Box>
      {children}
    </Box>
  );
}

function DesktopSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Box
      width="42px"
      height="18px"
      flexDirection="row"
      alignItems="center"
      justifyContent={checked ? "flex-end" : "flex-start"}
      backgroundColor={checked ? colors.selected : "rgba(255, 255, 255, 0.07)"}
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        onChange(!checked);
      }}
      data-gloom-interactive="true"
      style={{
        border: `1px solid ${checked ? colors.borderFocused : colors.border}`,
        borderRadius: 999,
        boxShadow: checked ? "inset 0 1px 0 rgba(255,255,255,0.10)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
        cursor: "pointer",
        paddingInline: 2,
      }}
    >
      <Box
        width="14px"
        height="14px"
        backgroundColor={checked ? colors.selectedText : colors.textMuted}
        style={{
          borderRadius: 999,
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
        }}
      />
    </Box>
  );
}

function DesktopValuePill({ value }: { value: string }) {
  return (
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="rgba(255, 255, 255, 0.06)"
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "1px 7px",
      }}
    >
      <Text fg={colors.textDim} style={desktopText(600)}>{value}</Text>
    </Box>
  );
}

function DesktopSettingsRow({
  field,
  selected,
  hovered,
  currentValue,
  onHover,
  onEdit,
  onApply,
}: {
  field: PaneSettingField;
  selected: boolean;
  hovered: boolean;
  currentValue: unknown;
  onHover: () => void;
  onEdit: () => void;
  onApply: (field: PaneSettingField, value: unknown) => void;
}) {
  const isToggle = field.type === "toggle";
  const isSelect = field.type === "select";
  const rowInteractive = !isSelect;
  const summary = summarizeValue(field, currentValue);
  const control = field.type === "toggle" ? (
    <DesktopSwitch checked={currentValue === true} onChange={(checked) => onApply(field, checked)} />
  ) : field.type === "select" ? (
    <Box
      width="100%"
      style={{
        marginTop: 4,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <SegmentedControl
        value={typeof currentValue === "string" ? currentValue : ""}
        options={field.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        onChange={(value) => onApply(field, value)}
      />
    </Box>
  ) : (
    <Box flexDirection="row" alignItems="center" gap={1}>
      <DesktopValuePill value={summary} />
      <Text fg={colors.textMuted} style={desktopText(600)}>Edit</Text>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      minHeight={field.description || isSelect ? undefined : 2}
      backgroundColor={hovered || selected ? "rgba(255, 255, 255, 0.045)" : "transparent"}
      onMouseMove={onHover}
      onMouseDown={rowInteractive
        ? (event: any) => {
          event.stopPropagation?.();
          event.preventDefault?.();
          if (isToggle) onApply(field, currentValue !== true);
          else onEdit();
        }
        : undefined}
      data-gloom-interactive={rowInteractive ? "true" : undefined}
      style={{
        borderBottom: `1px solid ${hovered || selected ? colors.borderFocused : colors.border}`,
        cursor: rowInteractive ? "pointer" : "default",
        padding: "6px 2px 7px",
        transition: "background-color 100ms ease, border-color 100ms ease",
      }}
    >
      <Box flexDirection="row" alignItems="center" width="100%">
        <Box flexDirection="row" flexGrow={1} minWidth={0} style={{ paddingRight: 12 }}>
          <Text fg={colors.text} style={desktopText(650)}>{field.label}</Text>
        </Box>
        {!isSelect && control}
      </Box>
      {field.description && (
        <Text fg={colors.textMuted} wrapText style={desktopText()}>
          {field.description}
        </Text>
      )}
      {isSelect && control}
    </Box>
  );
}

function DesktopSettingsList({
  fields,
  selectedIndex,
  hoveredFieldKey,
  settings,
  onHover,
  onEdit,
  onApply,
}: {
  fields: PaneSettingField[];
  selectedIndex: number;
  hoveredFieldKey: string | null;
  settings: Record<string, unknown>;
  onHover: (field: PaneSettingField, index: number) => void;
  onEdit: (field: PaneSettingField, index: number) => void;
  onApply: (field: PaneSettingField, value: unknown, index: number) => void;
}) {
  return (
    <Box
      flexDirection="column"
      style={{
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      {fields.map((field, index) => (
        <DesktopSettingsRow
          key={field.key}
          field={field}
          selected={index === selectedIndex && hoveredFieldKey === null}
          hovered={hoveredFieldKey === field.key}
          currentValue={settings[field.key]}
          onHover={() => onHover(field, index)}
          onEdit={() => onEdit(field, index)}
          onApply={(targetField, value) => onApply(targetField, value, index)}
        />
      ))}
    </Box>
  );
}

function useSelectFieldDialogController({
  dismiss,
  field,
  currentValue,
  onApply,
}: SelectFieldDialogProps) {
  const initialIndex = Math.max(0, field.options.findIndex((option) => option.value === currentValue));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const applyOption = (value: string) => {
    void onApply(value).then(() => dismiss()).catch(() => {});
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setSelectedIndex((index) => Math.max(0, index - 1));
    else if (event.name === "down" || event.name === "j") setSelectedIndex((index) => Math.min(field.options.length - 1, index + 1));
    else if (event.name === "escape") dismiss();
    else if (event.name === "enter" || event.name === "return" || isSpaceKey(event)) {
      const option = field.options[selectedIndex];
      if (!option) return;
      applyOption(option.value);
    }
  });

  return { selectedIndex, setSelectedIndex, applyOption };
}

function SelectFieldDialog(props: SelectFieldDialogProps) {
  return useUiHost().kind === "desktop-web"
    ? <DesktopSelectFieldDialog {...props} />
    : <TuiSelectFieldDialog {...props} />;
}

function DesktopSelectFieldDialog(props: SelectFieldDialogProps) {
  const { dismiss, field, currentValue } = props;
  const { selectedIndex, setSelectedIndex, applyOption } = useSelectFieldDialogController(props);

  return (
    <DesktopDialogSurface
      title={field.label}
      subtitle={field.description}
      dismiss={dismiss}
    >
      <Box flexDirection="column" style={{ borderTop: `1px solid ${colors.border}` }}>
        {field.options.map((option, index) => {
          const selected = option.value === currentValue;
          const focused = index === selectedIndex;
          return (
            <Box
              key={option.value}
              minHeight={option.description ? 4 : 3}
              flexDirection="row"
              alignItems="center"
              backgroundColor={selected || focused ? "rgba(255, 255, 255, 0.045)" : "transparent"}
              onMouseMove={() => setSelectedIndex(index)}
              onMouseDown={(event: any) => {
                event.stopPropagation?.();
                event.preventDefault?.();
                applyOption(option.value);
              }}
              data-gloom-interactive="true"
              style={{
                borderBottom: `1px solid ${selected || focused ? colors.borderFocused : colors.border}`,
                cursor: "pointer",
                padding: "6px 2px 7px",
              }}
            >
              <Box flexDirection="column" flexGrow={1} minWidth={0}>
                <Text fg={colors.textBright} style={desktopText(650)}>{option.label}</Text>
                {option.description && (
                  <Text fg={colors.textMuted} wrapText style={{ ...desktopText(), marginTop: 3 }}>
                    {option.description}
                  </Text>
                )}
              </Box>
              {selected && <DesktopValuePill value="Selected" />}
            </Box>
          );
        })}
      </Box>
    </DesktopDialogSurface>
  );
}

function TuiSelectFieldDialog(props: SelectFieldDialogProps) {
  const { field } = props;
  const { selectedIndex, setSelectedIndex, applyOption } = useSelectFieldDialogController(props);

  return (
    <DialogFrame
      title={field.label}
      footer="Use ↑↓ to choose · enter to apply · esc cancel"
    >
      <ListView
        items={field.options.map((option) => ({
          id: option.value,
          label: option.label,
          description: option.description,
        }))}
        selectedIndex={selectedIndex}
        bgColor={colors.commandBg}
        showSelectedDescription
        onSelect={setSelectedIndex}
        onActivate={(item) => {
          applyOption(item.id);
        }}
      />
    </DialogFrame>
  );
}

function useTextFieldDialogController({
  dismiss,
  currentValue,
  onApply,
}: TextFieldDialogProps) {
  const [value, setValue] = useState(typeof currentValue === "string" ? currentValue : "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    inputRef.current?.focus?.();
  }, []);

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      event.stopPropagation();
      dismiss();
    }
  });

  const submit = async () => {
    try {
      setError(null);
      await onApply(value);
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this value.");
    }
  };

  return { value, setValue, error, inputRef, submit };
}

function TextFieldDialog(props: TextFieldDialogProps) {
  return useUiHost().kind === "desktop-web"
    ? <DesktopTextFieldDialog {...props} />
    : <TuiTextFieldDialog {...props} />;
}

function DesktopTextFieldDialog(props: TextFieldDialogProps) {
  const { dismiss, field } = props;
  const { value, setValue, error, inputRef, submit } = useTextFieldDialogController(props);

  return (
    <DesktopDialogSurface
      title={field.label}
      subtitle={field.description}
      dismiss={dismiss}
    >
      <Box flexDirection="column" gap={1}>
        <TextField
          inputRef={inputRef}
          value={value}
          placeholder={field.placeholder}
          focused
          width={56}
          onChange={setValue}
          onSubmit={() => { void submit(); }}
        />
        {error && (
          <Text fg={colors.negative} wrapText style={desktopText(600)}>{error}</Text>
        )}
        <Box flexDirection="row" justifyContent="flex-end" style={{ marginTop: 12 }}>
          <Button label="Save" variant="primary" onPress={() => { void submit(); }} />
        </Box>
      </Box>
    </DesktopDialogSurface>
  );
}

function TuiTextFieldDialog(props: TextFieldDialogProps) {
  const { dismiss, field } = props;
  const { value, setValue, error, inputRef, submit } = useTextFieldDialogController(props);

  return (
    <DialogFrame
      title={field.label}
      footer="Enter to apply · esc cancel"
    >
      <Box flexDirection="column" gap={1}>
        <TextField
          inputRef={inputRef}
          value={value}
          placeholder={field.placeholder}
          focused
          onChange={setValue}
          onSubmit={() => { void submit(); }}
        />
        {error && (
          <Box height={1}>
            <Text fg={colors.negative}>{error}</Text>
          </Box>
        )}
        {field.description && (
          <Box height={1}>
            <Text fg={colors.textDim}>{field.description}</Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button label="Apply" variant="primary" onPress={() => { void submit(); }} />
          <Button label="Cancel" variant="ghost" onPress={dismiss} />
        </Box>
      </Box>
    </DialogFrame>
  );
}

function MultiSelectFieldDialog({
  dismiss,
  dialogId,
  field,
  currentValue,
  onApply,
}: AlertContext & {
  field: MultiSelectPaneSettingField;
  currentValue: unknown;
  onApply: (value: string[]) => Promise<void>;
}) {
  return (
    <MultiSelectDialogContent
      dismiss={dismiss}
      dialogId={dialogId}
      title={field.label}
      options={field.options}
      selectedValues={coerceSelectedValues(currentValue)}
      onChange={onApply}
      ordered={field.type === "ordered-multi-select"}
    />
  );
}

function DesktopUnavailablePaneSettingsDialog({ dismiss }: { dismiss: () => void }) {
  return (
    <DesktopDialogSurface title="Pane Settings" dismiss={dismiss}>
      <Text fg={colors.textDim} wrapText style={desktopText()}>
        This pane is no longer configurable.
      </Text>
    </DesktopDialogSurface>
  );
}

function TuiUnavailablePaneSettingsDialog() {
  return (
    <DialogFrame title="Pane Settings" footer="Press esc to cancel">
      <Text fg={colors.textDim}>This pane is no longer configurable.</Text>
    </DialogFrame>
  );
}

function DesktopPaneSettingsDialogBody({
  title,
  dismiss,
  fields,
  selectedIndex,
  hoveredFieldKey,
  settings,
  onHover,
  onEdit,
  onApply,
}: {
  title: string;
  dismiss: () => void;
  fields: PaneSettingField[];
  selectedIndex: number;
  hoveredFieldKey: string | null;
  settings: Record<string, unknown>;
  onHover: (field: PaneSettingField, index: number) => void;
  onEdit: (field: PaneSettingField, index: number) => void;
  onApply: (field: PaneSettingField, value: unknown, index: number) => void;
}) {
  return (
    <DesktopDialogSurface
      title={title}
      dismiss={dismiss}
    >
      {fields.length === 0 ? (
        <Text fg={colors.textDim} wrapText style={desktopText()}>
          No settings available.
        </Text>
      ) : (
        <DesktopSettingsList
          fields={fields}
          selectedIndex={selectedIndex}
          hoveredFieldKey={hoveredFieldKey}
          settings={settings}
          onHover={onHover}
          onEdit={onEdit}
          onApply={onApply}
        />
      )}
    </DesktopDialogSurface>
  );
}

function TuiPaneSettingsDialogBody({
  title,
  fields,
  selectedIndex,
  settings,
  onSelect,
  onActivate,
}: {
  title: string;
  fields: PaneSettingField[];
  selectedIndex: number;
  settings: Record<string, unknown>;
  onSelect: (index: number) => void;
  onActivate: (field: PaneSettingField | undefined) => void;
}) {
  return (
    <DialogFrame title={title} footer="Use ↑↓ to choose · enter to edit · esc cancel">
      <ListView
        items={fields.map((field) => ({
          id: field.key,
          label: field.label,
          description: field.description,
          detail: summarizeValue(field, settings[field.key]),
        }))}
        selectedIndex={selectedIndex}
        bgColor={colors.commandBg}
        showSelectedDescription
        onSelect={onSelect}
        onActivate={(_, index) => {
          onActivate(fields[index]);
        }}
        renderRow={(item, rowState) => (
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Box flexDirection="row">
              <Text fg={rowState.selected ? colors.selectedText : colors.textDim}>
                {rowState.selected ? "\u25b8 " : "  "}
              </Text>
              <Text
                fg={rowState.selected ? colors.text : colors.textDim}
                attributes={rowState.selected ? TextAttributes.BOLD : 0}
              >
                {item.label}
              </Text>
            </Box>
            <Text fg={rowState.selected ? colors.textMuted : colors.textMuted}>
              {item.detail}
            </Text>
          </Box>
        )}
      />
      {fields.length === 0 && (
        <Box height={1}>
          <Text fg={colors.textDim}>No settings available.</Text>
        </Box>
      )}
    </DialogFrame>
  );
}

export function PaneSettingsDialogContent({
  dismiss,
  paneId,
  pluginRegistry,
  applyFieldValue,
}: PaneSettingsDialogContentProps) {
  const dialog = useDialog();
  const isDesktop = useUiHost().kind === "desktop-web";
  const descriptor = pluginRegistry.resolvePaneSettings(paneId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredFieldKey, setHoveredFieldKey] = useState<string | null>(null);
  const [, setSettingsRevision] = useState(0);

  const fields = descriptor?.settingsDef.fields ?? [];

  useEffect(() => {
    if (selectedIndex >= fields.length) {
      setSelectedIndex(Math.max(0, fields.length - 1));
    }
  }, [fields.length, selectedIndex]);

  const applyAndRefresh = async (field: PaneSettingField, value: unknown) => {
    await applyFieldValue(paneId, field, value);
    setSettingsRevision((revision) => revision + 1);
  };

  const openFieldEditor = async (field: PaneSettingField | undefined) => {
    if (!field || !descriptor) return;
    const currentValue = descriptor.context.settings[field.key];

    if (field.type === "toggle") {
      await applyAndRefresh(field, currentValue !== true);
      return;
    }

    if (field.type === "select") {
      await dialog.alert({
        content: (ctx: AlertContext) => (
          <SelectFieldDialog
            {...ctx}
            field={field}
            currentValue={currentValue}
            onApply={(value) => applyAndRefresh(field, value)}
          />
        ),
      });
      return;
    }

    if (field.type === "text") {
      await dialog.alert({
        content: (ctx: AlertContext) => (
          <TextFieldDialog
            {...ctx}
            field={field}
            currentValue={currentValue}
            onApply={(value) => applyAndRefresh(field, value)}
          />
        ),
      });
      return;
    }

    await dialog.alert({
      content: (ctx: AlertContext) => (
        <MultiSelectFieldDialog
          {...ctx}
          field={field}
          currentValue={currentValue}
          onApply={(value) => applyAndRefresh(field, value)}
        />
      ),
    });
  };

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setSelectedIndex((index) => Math.max(0, index - 1));
    else if (event.name === "down" || event.name === "j") setSelectedIndex((index) => Math.min(fields.length - 1, index + 1));
    else if (event.name === "escape") dismiss();
    else if (event.name === "enter" || event.name === "return" || isSpaceKey(event)) {
      void openFieldEditor(fields[selectedIndex]).catch(() => {});
    }
  });

  if (!descriptor) {
    return isDesktop
      ? <DesktopUnavailablePaneSettingsDialog dismiss={dismiss} />
      : <TuiUnavailablePaneSettingsDialog />;
  }

  const title = descriptor.settingsDef.title ?? `${descriptor.paneDef.name} Settings`;

  return isDesktop ? (
    <DesktopPaneSettingsDialogBody
      title={title}
      dismiss={dismiss}
      fields={fields}
      selectedIndex={selectedIndex}
      hoveredFieldKey={hoveredFieldKey}
      settings={descriptor.context.settings}
      onHover={(field, index) => {
        setSelectedIndex(index);
        setHoveredFieldKey(field.key);
      }}
      onEdit={(field, index) => {
        setSelectedIndex(index);
        void openFieldEditor(field).catch(() => {});
      }}
      onApply={(field, value, index) => {
        setSelectedIndex(index);
        void applyAndRefresh(field, value).catch(() => {});
      }}
    />
  ) : (
    <TuiPaneSettingsDialogBody
      title={title}
      fields={fields}
      selectedIndex={selectedIndex}
      settings={descriptor.context.settings}
      onSelect={setSelectedIndex}
      onActivate={(field) => {
        void openFieldEditor(field).catch(() => {});
      }}
    />
  );
}
