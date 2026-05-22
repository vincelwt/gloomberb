import type { RefObject } from "react";
import { useEffect } from "react";
import {
  Box,
  ScrollBox,
  Text,
  Textarea,
  TextAttributes,
  type InputRenderable,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "../../ui";
import { Button, NumberField, Spinner, TextField } from "../ui";
import { NativeSelect, type NativeSelectElement } from "../ui/native-select";
import {
  coerceFieldString,
  getVisibleWorkflowFields,
  isWorkflowTextField,
  summarizeWorkflowFieldValue,
} from "./helpers";
import type {
  CommandBarFieldValue,
  CommandBarWorkflowField,
  CommandBarWorkflowRoute,
} from "./workflow-types";
import { getWorkflowFieldDescription } from "./workflow-view";
import { truncateText } from "./view-model";

interface CommandBarWorkflowBodyProps {
  route: CommandBarWorkflowRoute;
  bodyHeight: number;
  contentPadding: number;
  inputBg: string;
  nativePaneChrome: boolean;
  paletteBg: string;
  paletteSelectedBg: string;
  paletteSubtleText: string;
  paletteText: string;
  panelBg: string;
  queryDisplayWidth: number;
  themeBorder: string;
  themeBorderFocused: string;
  themeNegative: string;
  themePanel: string;
  workflowScrollRef: RefObject<ScrollBoxRenderable | null>;
  getWorkflowInputRef: (fieldId: string) => RefObject<InputRenderable | TextareaRenderable | null>;
  onActiveTextareaSync: (route: CommandBarWorkflowRoute) => void;
  onFieldFocus: (fieldId: string) => void;
  onFieldPickerOpen: (route: CommandBarWorkflowRoute, field: CommandBarWorkflowField) => void;
  onFieldValueChange: (fieldId: string, value: CommandBarFieldValue) => void;
  onMoveFieldFocus: (delta: number) => void;
  onNativeSelectRef: (fieldId: string, element: NativeSelectElement | null) => void;
  onSubmit: (route: CommandBarWorkflowRoute) => void | Promise<void>;
}

export function CommandBarWorkflowBody({
  route,
  bodyHeight,
  contentPadding,
  inputBg,
  nativePaneChrome,
  paletteBg,
  paletteSelectedBg,
  paletteSubtleText,
  paletteText,
  panelBg,
  queryDisplayWidth,
  themeBorder,
  themeBorderFocused,
  themeNegative,
  themePanel,
  workflowScrollRef,
  getWorkflowInputRef,
  onActiveTextareaSync,
  onFieldFocus,
  onFieldPickerOpen,
  onFieldValueChange,
  onMoveFieldFocus,
  onNativeSelectRef,
  onSubmit,
}: CommandBarWorkflowBodyProps) {
  const visibleFields = getVisibleWorkflowFields(route.fields, route.values);

  useEffect(() => {
    if (!nativePaneChrome) return;
    const scrollBox = workflowScrollRef.current;
    if (!scrollBox) return;
    const activeIndex = visibleFields.findIndex((field) => field.id === route.activeFieldId);
    if (activeIndex < 0) return;

    const estimatedFieldHeight = 4;
    const fieldTop = activeIndex * estimatedFieldHeight;
    const fieldBottom = fieldTop + estimatedFieldHeight;
    const viewportHeight = Math.max(1, scrollBox.viewport?.height ?? bodyHeight);
    if (fieldTop < scrollBox.scrollTop) {
      scrollBox.scrollTo(fieldTop);
    } else if (fieldBottom > scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(fieldBottom - viewportHeight);
    }
  }, [bodyHeight, nativePaneChrome, route.activeFieldId, visibleFields, workflowScrollRef]);

  const workflowContent = (
    <>
      {route.subtitle && (
        <Box height={1}>
          <Text fg={paletteSubtleText}>{truncateText(route.subtitle, queryDisplayWidth)}</Text>
        </Box>
      )}
      {route.description?.map((line, index) => (
        <Box key={`workflow-desc:${index}`} height={1}>
          <Text fg={paletteSubtleText}>{truncateText(line, queryDisplayWidth)}</Text>
        </Box>
      ))}
      {route.subtitle || (route.description?.length ?? 0) > 0 ? <Box height={1} /> : null}
      {visibleFields.map((field, fieldIndex) => {
        const active = field.id === route.activeFieldId;
        const isLastField = fieldIndex === visibleFields.length - 1;
        const value = route.values[field.id];
        const borderColor = active ? paletteSelectedBg : paletteBg;
        const fieldBg = nativePaneChrome ? "transparent" : active ? inputBg : panelBg;
        const useNativeSelect = nativePaneChrome && field.type === "select";
        const fieldDescription = getWorkflowFieldDescription(field, active);
        return (
          <Box
            key={field.id}
            flexDirection="column"
            {...(!nativePaneChrome ? { marginBottom: isLastField ? 0 : 1 } : {})}
            backgroundColor={fieldBg}
            onMouseDown={(event: any) => {
              event.stopPropagation?.();
              onActiveTextareaSync(route);
              onFieldFocus(field.id);
              if (!isWorkflowTextField(field) && !useNativeSelect) {
                onFieldPickerOpen(route, field);
              }
            }}
            style={nativePaneChrome ? {
              marginBottom: isLastField ? 8 : 10,
              paddingBlock: 3,
            } : undefined}
          >
            <Box height={1}>
              <Text fg={active ? paletteText : paletteSubtleText} attributes={active ? TextAttributes.BOLD : 0}>
                {field.label}
              </Text>
            </Box>
            {isWorkflowTextField(field) ? (
              field.type === "number" ? (
                <NumberField
                  inputRef={getWorkflowInputRef(field.id) as RefObject<InputRenderable | null>}
                  value={coerceFieldString(value)}
                  placeholder={field.placeholder}
                  focused={active && !route.pending}
                  variant="default"
                  backgroundColor={nativePaneChrome ? inputBg : fieldBg}
                  onChange={(nextValue) => onFieldValueChange(field.id, nextValue)}
                  onSubmit={() => {
                    const index = visibleFields.findIndex((entry) => entry.id === field.id);
                    if (index === visibleFields.length - 1) {
                      void onSubmit(route);
                    } else {
                      onMoveFieldFocus(1);
                    }
                  }}
                />
              ) : field.type === "textarea" ? (
                <Box
                  minHeight={6}
                  height={6}
                  border={!nativePaneChrome}
                  borderColor={active ? paletteSelectedBg : paletteBg}
                  backgroundColor={nativePaneChrome ? inputBg : fieldBg}
                  style={nativePaneChrome ? {
                    border: `1px solid ${active ? themeBorderFocused : themeBorder}`,
                    borderRadius: 6,
                    overflow: "hidden",
                  } : undefined}
                >
                  {active ? (
                    <Textarea
                      key={field.id}
                      ref={getWorkflowInputRef(field.id) as RefObject<TextareaRenderable | null>}
                      initialValue={coerceFieldString(value)}
                      placeholder={field.placeholder || ""}
                      focused={!route.pending}
                      textColor={paletteText}
                      placeholderColor={paletteSubtleText}
                      backgroundColor={nativePaneChrome ? inputBg : themePanel}
                      flexGrow={1}
                      wrapText
                    />
                  ) : (
                    <Box flexDirection="column" paddingX={1} paddingY={0}>
                      {(() => {
                        const preview = coerceFieldString(value).trim();
                        const lines = (preview || field.placeholder || "Unset")
                          .split("\n")
                          .flatMap((line) => line.match(new RegExp(`.{1,${Math.max(1, queryDisplayWidth - 8)}}`, "g")) ?? [""])
                          .slice(0, 4);
                        return lines.map((line, index) => (
                          <Box key={`${field.id}:preview:${index}`} height={1}>
                            <Text fg={preview ? paletteText : paletteSubtleText}>{line || " "}</Text>
                          </Box>
                        ));
                      })()}
                    </Box>
                  )}
                </Box>
              ) : (
                <TextField
                  inputRef={getWorkflowInputRef(field.id) as RefObject<InputRenderable | null>}
                  type={field.type === "password" ? "password" : "text"}
                  value={coerceFieldString(value)}
                  placeholder={field.placeholder}
                  focused={active && !route.pending}
                  variant="default"
                  backgroundColor={nativePaneChrome ? inputBg : fieldBg}
                  onChange={(nextValue) => onFieldValueChange(field.id, nextValue)}
                  onSubmit={() => {
                    const index = visibleFields.findIndex((entry) => entry.id === field.id);
                    if (index === visibleFields.length - 1) {
                      void onSubmit(route);
                    } else {
                      onMoveFieldFocus(1);
                    }
                  }}
                />
              )
            ) : useNativeSelect ? (
              <NativeSelect
                value={coerceFieldString(value)}
                options={field.options}
                width="100%"
                selectRef={(element) => onNativeSelectRef(field.id, element)}
                onFocus={() => onFieldFocus(field.id)}
                onChange={(nextValue) => onFieldValueChange(field.id, nextValue)}
              />
            ) : (
              <Box
                height={1}
                backgroundColor={nativePaneChrome ? "transparent" : borderColor}
                onMouseDown={(event: any) => {
                  event.stopPropagation?.();
                  onFieldPickerOpen(route, field);
                }}
                style={nativePaneChrome ? { borderRadius: 4 } : undefined}
              >
                <Text fg={active ? paletteText : paletteSubtleText}>
                  {truncateText(summarizeWorkflowFieldValue(field, value), queryDisplayWidth)}
                </Text>
              </Box>
            )}
            {fieldDescription && (
              <Box height={1}>
                <Text fg={paletteSubtleText}>
                  {truncateText(fieldDescription, queryDisplayWidth)}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
      {route.error && (
        <Box height={1}>
          <Text fg={themeNegative}>{truncateText(route.error, queryDisplayWidth)}</Text>
        </Box>
      )}
      {route.pendingLabel && route.pending && (
        <Box height={1}>
          <Spinner label={route.pendingLabel} />
        </Box>
      )}
      {!nativePaneChrome && <Box flexGrow={1} />}
      <Box flexDirection="row" gap={1} justifyContent={visibleFields.some((field) => field.type === "textarea") ? "flex-end" : "flex-start"}>
        <Button label={route.submitLabel} variant="primary" onPress={() => { void onSubmit(route); }} disabled={route.pending} />
      </Box>
    </>
  );

  if (nativePaneChrome) {
    return (
      <ScrollBox
        ref={workflowScrollRef}
        height={bodyHeight}
        scrollY
        style={{ overflowX: "hidden", paddingRight: 4 }}
      >
        <Box
          flexDirection="column"
          paddingX={contentPadding}
        >
          {workflowContent}
        </Box>
      </ScrollBox>
    );
  }

  return (
    <Box flexDirection="column" height={bodyHeight} paddingX={contentPadding}>
      {workflowContent}
    </Box>
  );
}
