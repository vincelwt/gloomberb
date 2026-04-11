import { useRef, useEffect, useCallback } from "react";
import { SyntaxStyle, RGBA } from "@opentui/core";
import type { TextareaRenderable, Highlight } from "@opentui/core";
import { colors } from "../theme/colors";

interface LinePattern {
  regex: RegExp;
  styleId: string;
}

// Patterns applied per-line (no 'g' or 'm' flags — we iterate lines ourselves)
const LINE_PATTERNS: LinePattern[] = [
  // Full-line heading
  { regex: /^#{1,3}\s+.+$/, styleId: "md.heading" },
  // Bold **text**
  { regex: /\*\*[^*]+\*\*/, styleId: "md.bold" },
  // Italic *text* (not **)
  { regex: /(?<!\*)\*(?!\*)[^*]+\*(?!\*)/, styleId: "md.italic" },
  // Strikethrough ~~text~~
  { regex: /~~[^~]+~~/, styleId: "md.strikethrough" },
  // Inline code `text`
  { regex: /`[^`]+`/, styleId: "md.code" },
  // List markers
  { regex: /^(\s*[-*]|\s*\d+\.)\s/, styleId: "md.list" },
];

function createMarkdownStyle(): { style: SyntaxStyle; ids: Record<string, number> } {
  const style = SyntaxStyle.create();
  const ids: Record<string, number> = {};
  ids["md.heading"] = style.registerStyle("md.heading", {
    fg: RGBA.fromHex(colors.borderFocused),
    bold: true,
  });
  ids["md.bold"] = style.registerStyle("md.bold", { bold: true });
  ids["md.italic"] = style.registerStyle("md.italic", { italic: true });
  ids["md.strikethrough"] = style.registerStyle("md.strikethrough", { dim: true });
  ids["md.code"] = style.registerStyle("md.code", {
    fg: RGBA.fromHex(colors.textDim),
  });
  ids["md.list"] = style.registerStyle("md.list", {
    fg: RGBA.fromHex(colors.borderFocused),
    bold: true,
  });
  return { style, ids };
}

function computeLineHighlights(
  line: string,
  ids: Record<string, number>,
): Highlight[] {
  const highlights: Highlight[] = [];
  for (const pattern of LINE_PATTERNS) {
    const id = ids[pattern.styleId];
    if (id == null) continue;
    // Use a global copy to find all matches on this line
    const globalRe = new RegExp(pattern.regex.source, "g");
    let match: RegExpExecArray | null;
    while ((match = globalRe.exec(line)) !== null) {
      highlights.push({
        start: match.index,
        end: match.index + match[0].length,
        styleId: id,
      });
      if (match[0].length === 0) break; // safety
    }
  }
  return highlights;
}

export interface MarkdownEditorProps {
  textareaKey?: string;
  focused: boolean;
  initialValue?: string;
  placeholder?: string;
  onRef?: (ref: TextareaRenderable | null) => void;
}

export function MarkdownEditor({
  textareaKey,
  focused,
  initialValue = "",
  placeholder = "Write notes...",
  onRef,
}: MarkdownEditorProps) {
  const textareaRef = useRef<TextareaRenderable>(null);
  const styleRef = useRef<{ style: SyntaxStyle; ids: Record<string, number> } | null>(null);

  const applyHighlights = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !styleRef.current) return;
    const text = ta.editBuffer.getText();
    const lines = text.split("\n");
    const { ids } = styleRef.current;
    for (let i = 0; i < lines.length; i++) {
      ta.clearLineHighlights(i);
      const lineHls = computeLineHighlights(lines[i]!, ids);
      for (const hl of lineHls) {
        ta.addHighlight(i, hl);
      }
    }
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const created = createMarkdownStyle();
    styleRef.current = created;
    ta.syntaxStyle = created.style;
    applyHighlights();
    ta.onContentChange = () => applyHighlights();
    return () => {
      if (ta) ta.onContentChange = undefined;
    };
  }, [textareaKey, applyHighlights]);

  useEffect(() => {
    onRef?.(textareaRef.current);
    return () => onRef?.(null);
  }, [textareaKey, onRef]);

  return (
    <textarea
      key={textareaKey}
      ref={textareaRef}
      initialValue={initialValue}
      placeholder={placeholder}
      focused={focused}
      textColor={colors.text}
      placeholderColor={colors.textDim}
      backgroundColor={focused ? colors.panel : colors.bg}
      flexGrow={1}
      wrapText
    />
  );
}
