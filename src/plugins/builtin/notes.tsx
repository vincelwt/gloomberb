import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { NotesFiles } from "./notes-files";

function createNotesTab(notesFiles: NotesFiles) {
  return function NotesTab({ focused, onCapture }: DetailTabProps) {
    const { ticker } = usePaneTicker();
    const textareaRef = useRef<TextareaRenderable>(null);
    const [notesFocused, setNotesFocused] = useState(false);
    const [loadedNotes, setLoadedNotes] = useState("");

    const setNotesFocusedAndCapture = useCallback((value: boolean) => {
      setNotesFocused(value);
      onCapture(value);
    }, [onCapture]);

    const saveNotesFor = useCallback((symbol: string | null, text: string) => {
      if (!symbol) return;
      notesFiles.save(symbol, text).catch(() => {});
    }, [notesFiles]);

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!notesFocused && textarea && ticker?.metadata.ticker) {
        saveNotesFor(ticker.metadata.ticker, textarea.editBuffer.getText());
      }
    }, [notesFocused, ticker, saveNotesFor]);

    const tickerSymbol = ticker?.metadata.ticker ?? null;
    const prevSymbolRef = useRef<string | null>(null);
    useEffect(() => {
      if (tickerSymbol !== prevSymbolRef.current) {
        if (textareaRef.current && prevSymbolRef.current) {
          saveNotesFor(prevSymbolRef.current, textareaRef.current.editBuffer.getText());
        }
        prevSymbolRef.current = tickerSymbol;

        if (!tickerSymbol) {
          setLoadedNotes("");
          textareaRef.current?.setText("");
          return;
        }

        notesFiles.load(tickerSymbol).then((nextNotes) => {
          setLoadedNotes(nextNotes);
          textareaRef.current?.setText(nextNotes);
        }).catch(() => {
          setLoadedNotes("");
          textareaRef.current?.setText("");
        });
      }
    }, [tickerSymbol, saveNotesFor, notesFiles]);

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
            key={tickerSymbol ?? "none"}
            ref={textareaRef}
            initialValue={loadedNotes}
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
  };
}

export const notesPlugin: GloomPlugin = {
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Write notes about each ticker",
  toggleable: true,

  setup(ctx) {
    const notesFiles = new NotesFiles(ctx.getConfig().dataDir);
    const NotesTab = createNotesTab(notesFiles);

    ctx.on("ticker:removed", ({ symbol }) => {
      notesFiles.delete(symbol).catch(() => {});
    });

    ctx.registerDetailTab({
      id: "notes",
      name: "Notes",
      order: 50,
      component: NotesTab,
    });
  },
};
