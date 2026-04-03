import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable, InputRenderable } from "@opentui/core";
import type { GloomPlugin, DetailTabProps, PaneProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { MarkdownEditor } from "../../components/markdown-editor";
import { NotesFiles, type QuickNoteEntry } from "./notes-files";

function createNotesTab(notesFiles: NotesFiles) {
  return function NotesTab({ focused, onCapture }: DetailTabProps) {
    const { ticker } = usePaneTicker();
    const textareaRef = useRef<TextareaRenderable | null>(null);
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
          <MarkdownEditor
            textareaKey={tickerSymbol ?? "none"}
            focused={notesFocused}
            initialValue={loadedNotes}
            placeholder="Write notes about this ticker..."
            onRef={(ref) => { textareaRef.current = ref; }}
          />
        </box>
      </box>
    );
  };
}

let nextNoteId = 1;
function generateNoteId(): string {
  return `${Date.now()}-${nextNoteId++}`;
}

function createQuickNotesPane(notesFiles: NotesFiles) {
  return function QuickNotesPane({ focused }: PaneProps) {
    const textareaRef = useRef<TextareaRenderable | null>(null);
    const [editing, setEditing] = useState(false);
    const [tabs, setTabs] = useState<QuickNoteEntry[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const renameInputRef = useRef<InputRenderable>(null);
    const prevTabRef = useRef<string | null>(null);
    const loadedRef = useRef(false);

    // Load index on mount
    useEffect(() => {
      if (loadedRef.current) return;
      loadedRef.current = true;
      notesFiles.loadQuickNotesIndex().then((entries) => {
        if (entries.length === 0) {
          const id = generateNoteId();
          const initial: QuickNoteEntry[] = [{ id, title: "New" }];
          setTabs(initial);
          setActiveTabId(id);
          notesFiles.saveQuickNotesIndex(initial).catch(() => {});
        } else {
          setTabs(entries);
          setActiveTabId(entries[0]!.id);
        }
      });
    }, []);

    // Save current tab content before switching away
    const saveCurrentTab = useCallback(() => {
      const tabId = prevTabRef.current;
      if (tabId && textareaRef.current) {
        const text = textareaRef.current.editBuffer.getText();
        notesFiles.save(notesFiles.quickNoteKey(tabId), text).catch(() => {});
      }
    }, []);

    // Load content when active tab changes
    useEffect(() => {
      if (!activeTabId) return;
      if (prevTabRef.current && prevTabRef.current !== activeTabId) {
        saveCurrentTab();
      }
      prevTabRef.current = activeTabId;
      notesFiles.load(notesFiles.quickNoteKey(activeTabId)).then((text) => {
        textareaRef.current?.setText(text);
      }).catch(() => {
        textareaRef.current?.setText("");
      });
    }, [activeTabId, saveCurrentTab]);

    // Save on editing stop
    useEffect(() => {
      if (!editing) saveCurrentTab();
    }, [editing, saveCurrentTab]);

    const addTab = useCallback(() => {
      saveCurrentTab();
      const id = generateNoteId();
      const entry: QuickNoteEntry = { id, title: "New" };
      setTabs((prev) => {
        const next = [...prev, entry];
        notesFiles.saveQuickNotesIndex(next).catch(() => {});
        return next;
      });
      setActiveTabId(id);
      setEditing(false);
    }, [saveCurrentTab]);

    const removeTab = useCallback((id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const newId = generateNoteId();
          const fresh: QuickNoteEntry[] = [{ id: newId, title: "New" }];
          notesFiles.saveQuickNotesIndex(fresh).catch(() => {});
          setActiveTabId(newId);
          prevTabRef.current = null;
          return fresh;
        }
        notesFiles.saveQuickNotesIndex(next).catch(() => {});
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const newActive = next[Math.min(idx, next.length - 1)]!;
          setActiveTabId(newActive.id);
          prevTabRef.current = null;
        }
        return next;
      });
      notesFiles.delete(notesFiles.quickNoteKey(id)).catch(() => {});
      setEditing(false);
    }, [activeTabId]);

    const startRename = useCallback(() => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      setRenameValue(tab.title);
      setRenaming(true);
      setEditing(false);
    }, [tabs, activeTabId]);

    const commitRename = useCallback(() => {
      const value = renameInputRef.current?.editBuffer.getText().trim() || renameValue.trim();
      if (!value || !activeTabId) {
        setRenaming(false);
        return;
      }
      setTabs((prev) => {
        const next = prev.map((t) => (t.id === activeTabId ? { ...t, title: value } : t));
        notesFiles.saveQuickNotesIndex(next).catch(() => {});
        return next;
      });
      setRenaming(false);
    }, [activeTabId, renameValue]);

    useKeyboard((event) => {
      if (!focused) return;

      if (renaming) {
        if (event.name === "enter" || event.name === "return") {
          commitRename();
          return;
        }
        if (event.name === "escape") {
          setRenaming(false);
          return;
        }
        return;
      }

      const isEnter = event.name === "enter" || event.name === "return";
      if (isEnter && !editing) {
        setEditing(true);
        return;
      }
      if (event.name === "escape" && editing) {
        setEditing(false);
        return;
      }
      if (!editing) {
        if (event.name === "t") {
          addTab();
          return;
        }
        if (event.name === "w" && tabs.length > 0) {
          if (activeTabId) removeTab(activeTabId);
          return;
        }
        if (event.name === "r") {
          startRename();
          return;
        }
        // Tab navigation with [ and ]
        if ((event.name === "[" || event.name === "]") && tabs.length > 1) {
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          if (idx < 0) return;
          const next = event.name === "]"
            ? (idx + 1) % tabs.length
            : (idx - 1 + tabs.length) % tabs.length;
          saveCurrentTab();
          setActiveTabId(tabs[next]!.id);
          return;
        }
      }
    });

    return (
      <box flexDirection="column" flexGrow={1}>
        {/* Tab bar */}
        <box flexDirection="row" height={1}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <box key={tab.id} flexDirection="row">
                <text
                  fg={isActive ? colors.textBright : colors.textDim}
                  bg={isActive ? colors.selected : undefined}
                  attributes={isActive ? TextAttributes.BOLD : 0}
                  onMouseDown={() => {
                    if (tab.id !== activeTabId) {
                      saveCurrentTab();
                      setActiveTabId(tab.id);
                      setEditing(false);
                    }
                  }}
                  onDoubleClick={() => {
                    setActiveTabId(tab.id);
                    startRename();
                  }}
                >
                  {` ${tab.title} `}
                </text>
                {isActive && tabs.length > 1 ? (
                  <text
                    fg={colors.textMuted}
                    onMouseDown={() => removeTab(tab.id)}
                  >
                    {`x `}
                  </text>
                ) : <text>{` `}</text>}
              </box>
            );
          })}
          <text
            fg={colors.textMuted}
            onMouseDown={addTab}
          >
            {` + `}
          </text>
          <box flexGrow={1} />
          <text fg={colors.textMuted}>
            {renaming
              ? "type name, Enter to confirm"
              : editing
                ? "editing (Esc to stop)"
                : "Enter edit | t new | w close | r rename"}
          </text>
        </box>
        {/* Rename input */}
        {renaming && (
          <box height={1} flexDirection="row" paddingLeft={1}>
            <text fg={colors.textDim}>{"Rename: "}</text>
            <input
              ref={renameInputRef}
              initialValue={renameValue}
              focused={renaming}
              textColor={colors.text}
              backgroundColor={colors.panel}
              flexGrow={1}
              onChange={(val: string) => setRenameValue(val)}
            />
          </box>
        )}
        {/* Editor */}
        <box flexGrow={1} padding={1} onMouseDown={() => { if (!editing && !renaming) setEditing(true); }}>
          <MarkdownEditor
            textareaKey={activeTabId ?? "none"}
            focused={editing && !renaming}
            placeholder="Write notes..."
            onRef={(ref) => { textareaRef.current = ref; }}
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
  description: "Add markdown notes to your tickers.",
  toggleable: true,

  setup(ctx) {
    const notesFiles = new NotesFiles(ctx.getConfig().dataDir);
    const NotesTab = createNotesTab(notesFiles);
    const QuickNotesPane = createQuickNotesPane(notesFiles);

    ctx.on("ticker:removed", ({ symbol }) => {
      notesFiles.delete(symbol).catch(() => {});
    });

    ctx.registerDetailTab({
      id: "notes",
      name: "Notes",
      order: 50,
      component: NotesTab,
    });

    ctx.registerPane({
      id: "quick-notes",
      name: "Quick Notes",
      icon: "N",
      component: QuickNotesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 60, height: 20 },
    });

    ctx.registerPaneTemplate({
      id: "new-quick-notes-pane",
      paneId: "quick-notes",
      label: "Quick Notes",
      description: "Open a general-purpose notes scratchpad",
      keywords: ["notes", "quick", "scratchpad", "memo"],
      shortcut: { prefix: "NOTE" },
      createInstance: () => ({ placement: "floating" }),
    });
  },
};
