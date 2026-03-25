import { useState, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { SelectRenderable } from "@opentui/core";
import { colors } from "../../theme/colors";
import { useAppState } from "../../state/app-context";
import { saveConfig } from "../../data/config-store";
import type { ColumnConfig } from "../../types/config";

// All available columns that can be added
const ALL_COLUMNS: ColumnConfig[] = [
  { id: "ticker", label: "TICKER", width: 8, align: "left" },
  { id: "name", label: "NAME", width: 16, align: "left" },
  { id: "exchange", label: "EXCH", width: 10, align: "left" },
  { id: "price", label: "PRICE", width: 10, align: "right", format: "currency" },
  { id: "change", label: "CHG", width: 9, align: "right", format: "currency" },
  { id: "change_pct", label: "CHG%", width: 8, align: "right", format: "percent" },
  { id: "ext_hours", label: "EXT%", width: 8, align: "right", format: "percent" },
  { id: "market_cap", label: "MCAP", width: 10, align: "right", format: "compact" },
  { id: "pe", label: "P/E", width: 7, align: "right", format: "number" },
  { id: "dividend_yield", label: "DIV%", width: 7, align: "right", format: "percent" },
  { id: "shares", label: "SHARES", width: 10, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "cost_basis", label: "COST", width: 10, align: "right", format: "compact" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
];

const SECTIONS = ["general", "columns", "theme", "brokers"] as const;
type Section = typeof SECTIONS[number];

const SECTION_LABELS: Record<Section, string> = {
  general: "General",
  columns: "Columns",
  theme: "Theme",
  brokers: "Brokers",
};

function GeneralSection() {
  const { state } = useAppState();
  const config = state.config;

  const rows: [string, string][] = [
    ["Data Directory", config.dataDir],
    ["Base Currency", config.baseCurrency],
    ["Refresh Interval", `${config.refreshIntervalMinutes} min`],
    ["Portfolios", config.portfolios.map((p) => p.name).join(", ")],
    ["Watchlists", config.watchlists.map((w) => w.name).join(", ")],
    ["Plugins", config.plugins.join(", ")],
  ];

  return (
    <box flexDirection="column">
      {rows.map(([label, value]) => (
        <box key={label} flexDirection="row" height={1}>
          <box width={22}><text fg={colors.textDim}>{label}</text></box>
          <text fg={colors.text}>{value}</text>
        </box>
      ))}
    </box>
  );
}

function ColumnsSection({ focused }: { focused: boolean }) {
  const { state, dispatch } = useAppState();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<"list" | "add" | "width">("list");
  const [widthInput, setWidthInput] = useState("");
  const columns = state.config.columns;

  const persistColumns = useCallback((newCols: ColumnConfig[]) => {
    const newConfig = { ...state.config, columns: newCols };
    dispatch({ type: "SET_CONFIG", config: newConfig });
    saveConfig(newConfig).catch(() => {});
  }, [state.config, dispatch]);

  // Available columns not currently active
  const availableCols = ALL_COLUMNS.filter(
    (ac) => !columns.some((c) => c.id === ac.id)
  );

  const addSelectRef = useRef<SelectRenderable>(null);

  useKeyboard((event) => {
    if (!focused) return;

    if (mode === "add") {
      if (event.name === "escape") {
        setMode("list");
        event.stopPropagation();
        return;
      }
      // Let the select handle j/k/enter
      return;
    }

    if (mode === "width") {
      if (event.name === "escape") {
        setMode("list");
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const w = parseInt(widthInput, 10);
        if (w > 0 && w <= 50) {
          const newCols = [...columns];
          newCols[selectedIdx] = { ...newCols[selectedIdx]!, width: w };
          persistColumns(newCols);
        }
        setMode("list");
        event.stopPropagation();
        return;
      }
      if (event.name === "backspace") {
        setWidthInput((v) => v.slice(0, -1));
        event.stopPropagation();
        return;
      }
      if (/^\d$/.test(event.name)) {
        setWidthInput((v) => v + event.name);
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      return;
    }

    // List mode
    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((i) => Math.min(i + 1, columns.length - 1));
      event.stopPropagation();
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      event.stopPropagation();
    } else if (event.name === "J" || (event.name === "j" && event.shift)) {
      // Move column down
      if (selectedIdx < columns.length - 1) {
        const newCols = [...columns];
        [newCols[selectedIdx], newCols[selectedIdx + 1]] = [newCols[selectedIdx + 1]!, newCols[selectedIdx]!];
        persistColumns(newCols);
        setSelectedIdx(selectedIdx + 1);
      }
      event.stopPropagation();
    } else if (event.name === "K" || (event.name === "k" && event.shift)) {
      // Move column up
      if (selectedIdx > 0) {
        const newCols = [...columns];
        [newCols[selectedIdx - 1], newCols[selectedIdx]] = [newCols[selectedIdx]!, newCols[selectedIdx - 1]!];
        persistColumns(newCols);
        setSelectedIdx(selectedIdx - 1);
      }
      event.stopPropagation();
    } else if (event.name === "d" || event.name === "x") {
      // Remove column
      if (columns.length > 1) {
        const newCols = columns.filter((_, i) => i !== selectedIdx);
        persistColumns(newCols);
        setSelectedIdx(Math.min(selectedIdx, newCols.length - 1));
      }
      event.stopPropagation();
    } else if (event.name === "a") {
      // Add column
      if (availableCols.length > 0) {
        setMode("add");
      }
      event.stopPropagation();
    } else if (event.name === "w") {
      // Edit width
      setWidthInput(String(columns[selectedIdx]?.width ?? ""));
      setMode("width");
      event.stopPropagation();
    } else if (event.name === "t") {
      // Toggle align
      const col = columns[selectedIdx];
      if (col) {
        const newCols = [...columns];
        newCols[selectedIdx] = { ...col, align: col.align === "left" ? "right" : "left" };
        persistColumns(newCols);
      }
      event.stopPropagation();
    }
  });

  const handleAddColumn = useCallback((index: number) => {
    const col = availableCols[index];
    if (col) {
      const newCols = [...columns, col];
      persistColumns(newCols);
      setSelectedIdx(newCols.length - 1);
    }
    setMode("list");
  }, [availableCols, columns, persistColumns]);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Column list header */}
      <box flexDirection="row" height={1}>
        <box width={4}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>#</text></box>
        <box width={14}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>ID</text></box>
        <box width={10}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>Label</text></box>
        <box width={8}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>Width</text></box>
        <box width={8}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>Align</text></box>
        <box width={10}><text attributes={TextAttributes.BOLD} fg={colors.textDim}>Format</text></box>
      </box>

      {/* Column rows */}
      <scrollbox flexGrow={1} scrollY>
        {columns.map((col, idx) => {
          const isSel = idx === selectedIdx && mode === "list";
          return (
            <box
              key={col.id}
              flexDirection="row"
              height={1}
              backgroundColor={isSel ? colors.selected : colors.bg}
            >
              <box width={4}>
                <text fg={isSel ? colors.selectedText : colors.textDim}>{String(idx + 1)}</text>
              </box>
              <box width={14}>
                <text fg={isSel ? colors.selectedText : colors.text}>{col.id}</text>
              </box>
              <box width={10}>
                <text fg={isSel ? colors.selectedText : colors.text}>{col.label}</text>
              </box>
              <box width={8}>
                <text fg={isSel ? colors.selectedText : colors.text}>
                  {mode === "width" && idx === selectedIdx ? widthInput + "_" : String(col.width)}
                </text>
              </box>
              <box width={8}>
                <text fg={isSel ? colors.selectedText : colors.text}>{col.align}</text>
              </box>
              <box width={10}>
                <text fg={isSel ? colors.selectedText : colors.textDim}>{col.format || "—"}</text>
              </box>
            </box>
          );
        })}
      </scrollbox>

      {/* Add column overlay */}
      {mode === "add" && (
        <box flexDirection="column" marginTop={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Add Column:</text>
          <select
            ref={addSelectRef}
            options={availableCols.map((c) => ({
              name: `${c.id} (${c.label})`,
              description: `width: ${c.width}, align: ${c.align}${c.format ? `, format: ${c.format}` : ""}`,
              value: c.id,
            }))}
            focused={mode === "add" && focused}
            height={Math.min(availableCols.length + 1, 8)}
            selectedBackgroundColor={colors.selected}
            selectedTextColor={colors.selectedText}
            onSelect={handleAddColumn}
          />
        </box>
      )}

      {/* Help text */}
      <box height={1} marginTop={1}>
        <text fg={colors.textMuted}>
          {mode === "list"
            ? "j/k move  J/K reorder  a add  d remove  w width  t align"
            : mode === "add"
            ? "j/k select  Enter confirm  Esc cancel"
            : "type width  Enter confirm  Esc cancel"}
        </text>
      </box>
    </box>
  );
}

function ThemeSection() {
  const { state } = useAppState();
  return (
    <box flexDirection="column">
      <box flexDirection="row" height={1}>
        <box width={22}><text fg={colors.textDim}>Current Theme</text></box>
        <text fg={colors.text}>{state.config.theme}</text>
      </box>
      <box height={1} />
      <text fg={colors.textMuted}>Use the command bar (Ctrl+P) and type "theme" to switch themes.</text>
    </box>
  );
}

function BrokersSection() {
  const { state } = useAppState();

  return (
    <box flexDirection="column">
      {Object.entries(state.config.brokers).length === 0 ? (
        <text fg={colors.textDim}>No brokers configured. Edit config.json to add broker credentials.</text>
      ) : (
        Object.entries(state.config.brokers).map(([id, config]) => (
          <box key={id} flexDirection="column">
            <text attributes={TextAttributes.BOLD} fg={colors.text}>{id}</text>
            {Object.entries(config).map(([key, val]) => (
              <box key={key} flexDirection="row" height={1} paddingLeft={2}>
                <box width={20}><text fg={colors.textDim}>{key}</text></box>
                <text fg={colors.text}>
                  {key.includes("token") || key.includes("password") ? "••••••••" : String(val)}
                </text>
              </box>
            ))}
          </box>
        ))
      )}
    </box>
  );
}

export function ConfigPage() {
  const { dispatch } = useAppState();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [inContent, setInContent] = useState(false);
  const activeSection = SECTIONS[sectionIdx]!;

  useKeyboard((event) => {
    // Close on Escape (when not in content sub-mode) or Ctrl+,
    if ((event.name === "," && event.ctrl)) {
      dispatch({ type: "TOGGLE_CONFIG" });
      event.stopPropagation();
      return;
    }

    if (event.name === "escape") {
      if (inContent) {
        setInContent(false);
      } else {
        dispatch({ type: "TOGGLE_CONFIG" });
      }
      event.stopPropagation();
      return;
    }

    if (inContent) {
      // Content sections handle their own keys, but consume tab to switch back
      if (event.name === "tab") {
        setInContent(false);
        event.stopPropagation();
      }
      return;
    }

    // Sidebar navigation
    if (event.name === "j" || event.name === "down") {
      setSectionIdx((i) => Math.min(i + 1, SECTIONS.length - 1));
      event.stopPropagation();
    } else if (event.name === "k" || event.name === "up") {
      setSectionIdx((i) => Math.max(i - 1, 0));
      event.stopPropagation();
    } else if (event.name === "enter" || event.name === "return" || event.name === "l" || event.name === "right") {
      setInContent(true);
      event.stopPropagation();
    }

    // Consume all navigation keys
    if (["left", "right", "h", "l", "tab"].includes(event.name)) {
      event.stopPropagation();
    }
  });

  return (
    <box
      position="absolute"
      top={2}
      left={4}
      right={4}
      bottom={2}
      flexDirection="column"
      backgroundColor={colors.bg}
      borderStyle="rounded"
      borderColor={inContent ? colors.border : colors.borderFocused}
      title=" Settings "
      titleAlignment="center"
      zIndex={200}
    >
      <box flexDirection="row" flexGrow={1}>
        {/* Sidebar */}
        <box
          flexDirection="column"
          width={18}
          borderStyle="single"
          border={["right"]}
          borderColor={colors.border}
          paddingY={1}
        >
          {SECTIONS.map((s, idx) => (
            <box
              key={s}
              height={1}
              paddingX={1}
              backgroundColor={idx === sectionIdx ? (inContent ? colors.bg : colors.selected) : colors.bg}
            >
              <text
                fg={idx === sectionIdx ? (inContent ? colors.text : colors.selectedText) : colors.textDim}
                attributes={idx === sectionIdx ? TextAttributes.BOLD : 0}
              >
                {idx === sectionIdx && !inContent ? "> " : "  "}{SECTION_LABELS[s]}
              </text>
            </box>
          ))}
          <box flexGrow={1} />
          <box paddingX={1}>
            <text fg={colors.textMuted}>
              {inContent ? "Esc back" : "j/k  Enter"}
            </text>
          </box>
        </box>

        {/* Content */}
        <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
          <box height={1} marginBottom={1}>
            <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
              {SECTION_LABELS[activeSection]}
            </text>
          </box>
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "columns" && <ColumnsSection focused={inContent} />}
          {activeSection === "theme" && <ThemeSection />}
          {activeSection === "brokers" && <BrokersSection />}
        </box>
      </box>
    </box>
  );
}
