import { useRef, useState } from "react";
import { Box, Text, type InputRenderable, useUiHost } from "../../../ui";
import { Button, DialogFrame, TextField } from "../../../components/ui";
import { type PromptContext, useDialogKeyboard } from "../../../ui/dialog";
import { colors } from "../../../theme/colors";

export type DateWindowDialogResult =
  | { kind: "apply"; start: string; end: string }
  | { kind: "clear" }
  | null;

export interface DateWindowDialogProps extends PromptContext<DateWindowDialogResult> {
  initial?: { start: string; end: string };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function DateWindowDialog({ dialogId, resolve, initial }: DateWindowDialogProps) {
  const isDesktop = useUiHost().kind === "desktop-web";
  const [start, setStart] = useState(initial?.start.slice(0, 10) ?? "");
  const [end, setEnd] = useState(initial?.end.slice(0, 10) ?? "");
  const [activeField, setActiveField] = useState<"start" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<InputRenderable | null>(null);
  const endRef = useRef<InputRenderable | null>(null);

  const focus = (field: "start" | "end") => {
    setActiveField(field);
    queueMicrotask(() => (field === "start" ? startRef : endRef).current?.focus?.());
  };
  const submit = () => {
    if (!validDate(start) || !validDate(end)) {
      setError("Enter both dates as YYYY-MM-DD.");
      return;
    }
    if (Date.parse(start) > Date.parse(end)) {
      setError("Start date must be on or before end date.");
      return;
    }
    resolve({ kind: "apply", start, end });
  };

  useDialogKeyboard((event) => {
    if (event.name === "escape") {
      event.stopPropagation();
      if (activeField) {
        setActiveField(null);
      } else {
        resolve(null);
      }
      return;
    }
    if (event.name === "tab") {
      event.stopPropagation();
      focus(activeField === "start" ? "end" : "start");
      return;
    }
    if (!activeField && event.name === "c") {
      event.stopPropagation();
      resolve({ kind: "clear" });
      return;
    }
    if (!activeField && (event.name === "enter" || event.name === "return")) {
      event.stopPropagation();
      submit();
    }
  }, { scope: dialogId, allowEditable: true });

  return (
    <DialogFrame
      title="Custom Date Range"
      footer={isDesktop ? undefined : "Tab switch field · Enter apply · C clear · Esc cancel"}
    >
      <Box
        flexDirection="column"
        width={isDesktop ? "440px" : 48}
        gap={1}
        style={isDesktop ? { gap: 12 } : undefined}
      >
        <TextField
          label="Start date"
          value={start}
          placeholder="2021-01-01"
          type={isDesktop ? "date" : "text"}
          focused={activeField === "start"}
          inputRef={startRef}
          onMouseDown={() => focus("start")}
          onChange={(value) => { setStart(value); setError(null); }}
          onSubmit={() => focus("end")}
        />
        <TextField
          label="End date"
          value={end}
          placeholder="2026-01-01"
          type={isDesktop ? "date" : "text"}
          focused={activeField === "end"}
          inputRef={endRef}
          onMouseDown={() => focus("end")}
          onChange={(value) => { setEnd(value); setError(null); }}
          onSubmit={submit}
        />
        {error && <Text fg={colors.negative}>{error}</Text>}
        <Box
          flexDirection="row"
          gap={1}
          justifyContent={isDesktop ? "flex-end" : undefined}
          style={isDesktop ? { gap: 6, paddingTop: 2 } : undefined}
        >
          <Button label="Clear" shortcut={isDesktop ? undefined : "C"} variant="ghost" onPress={() => resolve({ kind: "clear" })} />
          <Button label="Cancel" variant="ghost" onPress={() => resolve(null)} />
          <Button label="Apply" variant="primary" onPress={submit} />
        </Box>
      </Box>
    </DialogFrame>
  );
}
