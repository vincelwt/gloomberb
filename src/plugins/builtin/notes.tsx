import { Box, Input, ScrollBox, Text, TextAttributes } from "../../ui";
import { useRef, useEffect, useState, useCallback } from "react";
import { useShortcut } from "../../react/input";
import { type InputRenderable, type TextareaRenderable } from "../../ui";
import type { GloomPlugin, DetailTabProps, PaneProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { MarkdownEditor } from "../../components/markdown-editor";
import { MarkdownText } from "../../components/markdown-text";
import { DialogFrame, TabBar, usePaneFooter } from "../../components";
import { type PromptContext, useDialog, useDialogKeyboard } from "../../ui/dialog";
import { NotesFiles, type QuickNoteEntry } from "./notes-files";

function useSyncedText(initialValue = "") {
  const [text, setTextState] = useState(initialValue);
  const textRef = useRef(initialValue);
  const setText = useCallback((nextText: string) => {
    textRef.current = nextText;
    setTextState(nextText);
  }, []);
  return { text, textRef, setText };
}

function noteContentWidth(width: number): number {
  return Math.max(1, Math.floor(width) - 2);
}

function formatLastEdited(updatedAt: number | undefined): string {
  if (!updatedAt) return "not edited";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (!Number.isFinite(elapsedSeconds)) return "not edited";
  if (elapsedSeconds < 60) return "now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return "yday";
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return `${elapsedWeeks}w ago`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo ago`;

  return `${Math.floor(elapsedDays / 365)}y ago`;
}

function MarkdownNotePreview({
  text,
  width,
  placeholder,
  onActivate,
}: {
  text: string;
  width: number;
  placeholder: string;
  onActivate: () => void;
}) {
  const lineWidth = noteContentWidth(width);
  const hasText = text.trim().length > 0;

  return (
    <ScrollBox
      flexGrow={1}
      width="100%"
      height="100%"
      scrollY
      focusable={false}
      onMouseDown={onActivate}
    >
      <Box flexDirection="column" flexGrow={1} width={lineWidth}>
        {hasText
          ? <MarkdownText text={text} lineWidth={lineWidth} />
          : <Text fg={colors.textDim}>{placeholder}</Text>}
      </Box>
    </ScrollBox>
  );
}

function ConfirmDeleteNoteDialog({
  resolve,
  title,
}: PromptContext<boolean> & {
  title: string;
}) {
  const confirm = useCallback(() => resolve(true), [resolve]);
  const cancel = useCallback(() => resolve(false), [resolve]);
  const displayTitle = title.length > 28 ? `${title.slice(0, 25)}...` : title;

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "enter" || event.name === "return") {
      confirm();
      return;
    }
    if (event.name === "escape") {
      cancel();
    }
  });

  return (
    <DialogFrame title="Delete note?" footer="Enter delete · Esc cancel">
      <Box flexDirection="column" width={44}>
        <Text fg={colors.text}>{`Delete "${displayTitle}"?`}</Text>
        <Box height={1} />
        <Text fg={colors.textDim}>This note has content.</Text>
        <Text fg={colors.textDim}>Deleting it cannot be undone.</Text>
        <Box height={1} />
        <Box flexDirection="row" gap={1}>
          <Box
            backgroundColor={colors.negative}
            onMouseDown={confirm}
            data-gloom-interactive="true"
          >
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{" Delete "}</Text>
          </Box>
          <Box
            backgroundColor={colors.panel}
            onMouseDown={cancel}
            data-gloom-interactive="true"
          >
            <Text fg={colors.text}>{" Cancel "}</Text>
          </Box>
        </Box>
      </Box>
    </DialogFrame>
  );
}

function createNotesTab(notesFiles: NotesFiles) {
  return function NotesTab({ focused, width, onCapture }: DetailTabProps) {
    const { ticker } = usePaneTicker();
    const textareaRef = useRef<TextareaRenderable | null>(null);
    const [notesFocused, setNotesFocused] = useState(false);
    const { text: noteText, textRef: noteTextRef, setText: setNoteText } = useSyncedText("");
    const wasNotesFocusedRef = useRef(false);

    const setNotesFocusedAndCapture = useCallback((value: boolean) => {
      setNotesFocused(value);
      onCapture(value);
    }, [onCapture]);

    const getCurrentNoteText = useCallback(() => (
      textareaRef.current?.editBuffer.getText() ?? noteTextRef.current
    ), [noteTextRef]);

    const saveNotesFor = useCallback((symbol: string | null, text: string) => {
      if (!symbol) return;
      notesFiles.save(symbol, text).catch(() => {});
    }, [notesFiles]);

    useEffect(() => {
      if (wasNotesFocusedRef.current && !notesFocused && ticker?.metadata.ticker) {
        saveNotesFor(ticker.metadata.ticker, getCurrentNoteText());
      }
      wasNotesFocusedRef.current = notesFocused;
    }, [getCurrentNoteText, notesFocused, ticker, saveNotesFor]);

    const tickerSymbol = ticker?.metadata.ticker ?? null;
    const prevSymbolRef = useRef<string | null>(null);
    useEffect(() => {
      if (tickerSymbol !== prevSymbolRef.current) {
        if (textareaRef.current && prevSymbolRef.current) {
          saveNotesFor(prevSymbolRef.current, textareaRef.current.editBuffer.getText());
        }
        prevSymbolRef.current = tickerSymbol;

        if (!tickerSymbol) {
          setNoteText("");
          textareaRef.current?.setText("");
          return;
        }

        notesFiles.load(tickerSymbol).then((nextNotes) => {
          setNoteText(nextNotes);
          textareaRef.current?.setText(nextNotes);
        }).catch(() => {
          setNoteText("");
          textareaRef.current?.setText("");
        });
      }
    }, [tickerSymbol, saveNotesFor, notesFiles, setNoteText]);

    useShortcut((event) => {
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

    usePaneFooter("ticker-notes", () => ({
      info: [
        { id: "mode", parts: [{ text: notesFocused ? "editing" : "viewing", tone: "muted" }] },
      ],
    }), [notesFocused]);

    if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view notes.</Text>;

    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexGrow={1} minHeight={0} paddingX={1} onMouseDown={() => { if (!notesFocused) setNotesFocusedAndCapture(true); }}>
          {notesFocused ? (
            <MarkdownEditor
              textareaKey={tickerSymbol ?? "none"}
              focused={notesFocused}
              initialValue={noteText}
              placeholder="Write notes about this ticker..."
              onRef={(ref) => { textareaRef.current = ref; }}
              onChange={setNoteText}
            />
          ) : (
            <MarkdownNotePreview
              text={noteText}
              width={width}
              placeholder="Write notes about this ticker..."
              onActivate={() => setNotesFocusedAndCapture(true)}
            />
          )}
        </Box>
      </Box>
    );
  };
}

let nextNoteId = 1;
function generateNoteId(): string {
  return `${Date.now()}-${nextNoteId++}`;
}

function createQuickNotesPane(notesFiles: NotesFiles) {
  return function QuickNotesPane({ focused, width }: PaneProps) {
    const dialog = useDialog();
    const textareaRef = useRef<TextareaRenderable | null>(null);
    const [editing, setEditing] = useState(false);
    const [tabs, setTabs] = useState<QuickNoteEntry[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const { text: noteText, textRef: noteTextRef, setText: setNoteText } = useSyncedText("");
    const renameInputRef = useRef<InputRenderable>(null);
    const prevTabRef = useRef<string | null>(null);
    const lastSavedTextRef = useRef<Map<string, string>>(new Map());
    const loadedRef = useRef(false);
    const activeTab = tabs.find((tab) => tab.id === activeTabId);

    const saveQuickNotesIndex = useCallback((entries: QuickNoteEntry[]) => {
      notesFiles.saveQuickNotesIndex(entries).catch(() => {});
    }, [notesFiles]);

    const readActiveNoteText = useCallback(() => (
      textareaRef.current?.editBuffer.getText() ?? noteTextRef.current
    ), [noteTextRef]);

    const saveTab = useCallback((tabId: string | null) => {
      if (!tabId) return;
      if (!lastSavedTextRef.current.has(tabId)) return;
      const text = tabId === activeTabId ? readActiveNoteText() : noteTextRef.current;
      if (lastSavedTextRef.current.get(tabId) === text) return;

      lastSavedTextRef.current.set(tabId, text);
      notesFiles.save(notesFiles.quickNoteKey(tabId), text).catch(() => {});

      const updatedAt = Date.now();
      setTabs((prev) => {
        if (!prev.some((tab) => tab.id === tabId)) return prev;
        const next = prev.map((tab) => (tab.id === tabId ? { ...tab, updatedAt } : tab));
        saveQuickNotesIndex(next);
        return next;
      });
    }, [activeTabId, noteTextRef, notesFiles, readActiveNoteText, saveQuickNotesIndex]);

    // Load index on mount
    useEffect(() => {
      if (loadedRef.current) return;
      loadedRef.current = true;
      notesFiles.loadQuickNotesIndex().then((entries) => {
        if (entries.length === 0) {
          const id = generateNoteId();
          const initial: QuickNoteEntry[] = [{ id, title: "New" }];
          lastSavedTextRef.current.set(id, "");
          setTabs(initial);
          setActiveTabId(id);
          saveQuickNotesIndex(initial);
        } else {
          setTabs(entries);
          setActiveTabId(entries[0]!.id);
        }
      });
    }, [notesFiles, saveQuickNotesIndex]);

    // Load content when active tab changes
    useEffect(() => {
      if (!activeTabId) {
        setNoteText("");
        return;
      }
      prevTabRef.current = activeTabId;
      let cancelled = false;
      notesFiles.load(notesFiles.quickNoteKey(activeTabId)).then((text) => {
        if (cancelled) return;
        lastSavedTextRef.current.set(activeTabId, text);
        setNoteText(text);
        textareaRef.current?.setText(text);
      }).catch(() => {
        if (cancelled) return;
        lastSavedTextRef.current.set(activeTabId, "");
        setNoteText("");
        textareaRef.current?.setText("");
      });
      return () => {
        cancelled = true;
      };
    }, [activeTabId, notesFiles, setNoteText]);

    // Save on editing stop
    useEffect(() => {
      if (!editing) saveTab(activeTabId);
    }, [activeTabId, editing, saveTab]);

    const addTab = useCallback(() => {
      saveTab(activeTabId);
      const id = generateNoteId();
      const entry: QuickNoteEntry = { id, title: "New" };
      lastSavedTextRef.current.set(id, "");
      setTabs((prev) => {
        const next = [...prev, entry];
        saveQuickNotesIndex(next);
        return next;
      });
      setActiveTabId(id);
      setNoteText("");
      setEditing(false);
      setRenaming(false);
    }, [activeTabId, saveQuickNotesIndex, saveTab, setNoteText]);

    const removeTab = useCallback((id: string) => {
      lastSavedTextRef.current.delete(id);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const newId = generateNoteId();
          const fresh: QuickNoteEntry[] = [{ id: newId, title: "New" }];
          lastSavedTextRef.current.set(newId, "");
          saveQuickNotesIndex(fresh);
          setActiveTabId(newId);
          setNoteText("");
          prevTabRef.current = null;
          return fresh;
        }
        saveQuickNotesIndex(next);
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const newActive = next[Math.min(idx, next.length - 1)]!;
          setActiveTabId(newActive.id);
          setNoteText("");
          prevTabRef.current = null;
        }
        return next;
      });
      notesFiles.delete(notesFiles.quickNoteKey(id)).catch(() => {});
      setEditing(false);
      setRenaming(false);
    }, [activeTabId, notesFiles, saveQuickNotesIndex, setNoteText]);

    const requestRemoveTab = useCallback(async (id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      const text = id === activeTabId
        ? readActiveNoteText()
        : await notesFiles.load(notesFiles.quickNoteKey(id));

      if (text.trim().length > 0) {
        const confirmed = await dialog.prompt<boolean>({
          closeOnClickOutside: true,
          content: (ctx: PromptContext<boolean>) => (
            <ConfirmDeleteNoteDialog
              {...ctx}
              title={tab?.title ?? "Note"}
            />
          ),
        }).catch(() => false);
        if (confirmed !== true) return;
      }

      removeTab(id);
    }, [activeTabId, dialog, notesFiles, readActiveNoteText, removeTab, tabs]);

    const startRename = useCallback(() => {
      if (!activeTab) return;
      setRenameValue(activeTab.title);
      setRenaming(true);
      setEditing(false);
    }, [activeTab]);

    const startRenameTab = useCallback((id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab) return;
      if (id !== activeTabId) saveTab(activeTabId);
      setActiveTabId(id);
      setRenameValue(tab.title);
      setRenaming(true);
      setEditing(false);
    }, [activeTabId, saveTab, tabs]);

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

    useShortcut((event) => {
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
        if (event.name === "n" || event.name === "t") {
          addTab();
          return;
        }
        if (event.name === "w" && tabs.length > 0) {
          if (activeTabId) void requestRemoveTab(activeTabId);
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
          saveTab(activeTabId);
          setActiveTabId(tabs[next]!.id);
          return;
        }
      }
    });

    usePaneFooter("quick-notes", () => ({
      info: [
        { id: "edited", parts: [{ text: editing || renaming ? "editing" : formatLastEdited(activeTab?.updatedAt), tone: "muted" }] },
      ],
      hints: editing || renaming
        ? []
        : [
            { id: "new", key: "n", label: "new", onPress: addTab },
            { id: "rename", key: "r", label: "rename", onPress: startRename, disabled: !activeTabId },
          ],
    }), [activeTab, activeTabId, addTab, editing, renaming, startRename]);

    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box height={1}>
          <TabBar
            tabs={tabs.map((tab) => ({
              label: tab.title,
              value: tab.id,
              onClose: tabs.length > 1 ? (id) => { void requestRemoveTab(id); } : undefined,
              onDoubleClick: startRenameTab,
            }))}
            activeValue={activeTabId}
            onSelect={(id) => {
              if (id === activeTabId) return;
              saveTab(activeTabId);
              setActiveTabId(id);
              setEditing(false);
            }}
            compact
            variant="pill"
            closeMode="active"
            onAdd={addTab}
          />
        </Box>
        {/* Rename input */}
        {renaming && (
          <Box height={1} flexDirection="row" paddingLeft={1}>
            <Text fg={colors.textDim}>{"Rename: "}</Text>
            <Input
              ref={renameInputRef}
              initialValue={renameValue}
              focused={renaming}
              textColor={colors.text}
              backgroundColor={colors.panel}
              flexGrow={1}
              onChange={(val: string) => setRenameValue(val)}
            />
          </Box>
        )}
        <Box flexGrow={1} minHeight={0} paddingX={1} onMouseDown={() => { if (!editing && !renaming) setEditing(true); }}>
          {editing && !renaming ? (
            <MarkdownEditor
              textareaKey={activeTabId ?? "none"}
              focused
              initialValue={noteText}
              placeholder="Write notes..."
              onRef={(ref) => { textareaRef.current = ref; }}
              onChange={setNoteText}
            />
          ) : (
            <MarkdownNotePreview
              text={noteText}
              width={width}
              placeholder="Write notes..."
              onActivate={() => { if (!renaming) setEditing(true); }}
            />
          )}
        </Box>
      </Box>
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
      name: "Notes",
      icon: "N",
      component: QuickNotesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 60, height: 20 },
    });

    ctx.registerPaneTemplate({
      id: "new-quick-notes-pane",
      paneId: "quick-notes",
      label: "Notes",
      description: "Open a general-purpose notes scratchpad",
      keywords: ["notes", "quick", "scratchpad", "memo"],
      shortcut: { prefix: "NOTE" },
      createInstance: () => ({ placement: "floating" }),
    });
  },
};
