import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { useAppState, usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { getSharedMarkdownStore } from "../../plugins/registry";

function NotesTab({ focused, onCapture }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const { dispatch } = useAppState();
  const textareaRef = useRef<TextareaRenderable>(null);
  const [notesFocused, setNotesFocused] = useState(false);

  const setNotesFocusedAndCapture = useCallback((val: boolean) => {
    setNotesFocused(val);
    onCapture(val);
  }, [onCapture]);

  // Save helper that persists textarea text for a given ticker
  const saveNotesFor = useCallback((t: typeof ticker, text: string) => {
    if (t && text !== t.notes) {
      const updated = { ...t, notes: text };
      dispatch({ type: "UPDATE_TICKER", ticker: updated });
      const markdownStore = getSharedMarkdownStore();
      if (markdownStore) {
        markdownStore.saveTicker(updated).catch(() => {});
      }
    }
  }, [dispatch]);

  // Save notes when unfocusing
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!notesFocused && textarea && ticker) {
      saveNotesFor(ticker, textarea.editBuffer.getText());
    }
  }, [notesFocused, ticker, saveNotesFor]);

  // When the selected ticker changes, save pending edits and load new notes
  const tickerSymbol = ticker?.frontmatter.ticker ?? null;
  const prevTickerRef = useRef(ticker);
  const prevSymbolRef = useRef(tickerSymbol);
  useEffect(() => {
    if (tickerSymbol !== prevSymbolRef.current) {
      // Save edits for the previous ticker
      if (textareaRef.current && prevTickerRef.current) {
        saveNotesFor(prevTickerRef.current, textareaRef.current.editBuffer.getText());
      }
      prevSymbolRef.current = tickerSymbol;
      prevTickerRef.current = ticker;
      // Update textarea content to new ticker's notes
      if (textareaRef.current) {
        textareaRef.current.setText(ticker?.notes || "");
      }
    }
  }, [tickerSymbol, ticker, saveNotesFor]);

  // Handle keyboard for enter/escape focus toggle
  useKeyboard((event) => {
    if (!focused) return;
    const isEnter = event.name === "enter" || event.name === "return";
    if (isEnter && !notesFocused) {
      setNotesFocusedAndCapture(true);
      return;
    }
    if (event.name === "escape" && notesFocused) {
      setNotesFocusedAndCapture(false);
      return;
    }
  });

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view notes.</text>;

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box flexDirection="row" height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Notes</text>
        <box flexGrow={1} />
        <text fg={colors.textMuted}>
          {notesFocused ? "editing (Esc to stop)" : "Enter to edit"}
        </text>
      </box>
      <box height={1} />
      <box flexGrow={1} onMouseDown={() => { if (!notesFocused) setNotesFocusedAndCapture(true); }}>
        <textarea
          ref={textareaRef}
          initialValue={ticker.notes || ""}
          placeholder="Write notes about this ticker..."
          focused={notesFocused}
          textColor={colors.text}
          placeholderColor={colors.textDim}
          backgroundColor={notesFocused ? colors.panel : colors.bg}
          flexGrow={1}
        />
      </box>
    </box>
  );
}

export const notesPlugin: GloomPlugin = {
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Write notes about each ticker",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "notes",
      name: "Notes",
      order: 50,
      component: NotesTab,
    });
  },
};
