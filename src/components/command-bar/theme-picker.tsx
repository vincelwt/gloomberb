import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, ScrollBox, Text } from "../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { getThemeIds, themes as themeRegistry } from "../../theme/themes";
import { truncateText } from "./view-model";

const THEME_PREVIEW_DEBOUNCE_MS = 120;
const THEME_OPTIONS = getThemeIds().map((id) => ({
  id,
  name: themeRegistry[id]!.name,
}));

interface ThemePickerScrollEvent {
  stopPropagation: () => void;
  preventDefault: () => void;
  scroll?: { direction?: string; delta?: number };
}

interface ThemePickerProps {
  filter: string;
  committedThemeId: string;
  height: number;
  contentPadding: number;
  labelWidth: number;
  trailingWidth: number;
  queryDisplayWidth: number;
  nativePaneChrome: boolean;
  paletteBg: string;
  paletteHoverBg: string;
  paletteSelectedBg: string;
  paletteSelectedText: string;
  paletteSubtleText: string;
  paletteText: string;
  panelBg: string;
  onPreview: (themeId: string | null) => void;
  onCommit: (themeId: string) => void;
}

export interface ThemePickerHandle {
  move: (delta: number) => boolean;
  commit: () => boolean;
  cancelPreview: () => void;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

export const ThemePicker = memo(forwardRef<ThemePickerHandle, ThemePickerProps>(function ThemePicker({
  filter,
  committedThemeId,
  height,
  contentPadding,
  labelWidth,
  trailingWidth,
  queryDisplayWidth,
  nativePaneChrome,
  paletteBg,
  paletteHoverBg,
  paletteSelectedBg,
  paletteSelectedText,
  paletteSubtleText,
  paletteText,
  panelBg,
  onPreview,
  onCommit,
}: ThemePickerProps, ref) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewIdRef = useRef<string | null>(null);
  const committedThemeIdRef = useRef(committedThemeId);
  const onPreviewRef = useRef(onPreview);
  const onCommitRef = useRef(onCommit);
  const normalizedFilter = filter.trim().toLowerCase();
  const themes = useMemo(() => {
    if (!normalizedFilter) return THEME_OPTIONS;
    return THEME_OPTIONS.filter((theme) => (
      theme.name.toLowerCase().includes(normalizedFilter)
      || theme.id.toLowerCase().includes(normalizedFilter)
    ));
  }, [normalizedFilter]);
  const [selectedIndex, setSelectedIndex] = useState(() => (
    Math.max(0, themes.findIndex((theme) => theme.id === committedThemeId))
  ));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const themesRef = useRef(themes);
  const selectedIndexRef = useRef(selectedIndex);

  themesRef.current = themes;
  selectedIndexRef.current = selectedIndex;
  committedThemeIdRef.current = committedThemeId;
  onPreviewRef.current = onPreview;
  onCommitRef.current = onCommit;

  const cancelPreview = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    pendingPreviewIdRef.current = null;
  }, []);

  const requestPreview = useCallback((themeId: string) => {
    pendingPreviewIdRef.current = themeId;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      const nextThemeId = pendingPreviewIdRef.current;
      pendingPreviewIdRef.current = null;
      if (!nextThemeId) return;
      onPreviewRef.current(nextThemeId === committedThemeIdRef.current ? null : nextThemeId);
    }, THEME_PREVIEW_DEBOUNCE_MS);
  }, []);

  const move = useCallback((delta: number): boolean => {
    const options = themesRef.current;
    if (options.length === 0 || delta === 0) return false;
    const nextIndex = clampIndex(selectedIndexRef.current + delta, options.length);
    if (nextIndex === selectedIndexRef.current) return false;
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
    setHoveredIndex(null);
    requestPreview(options[nextIndex]!.id);
    return true;
  }, [requestPreview]);

  const commit = useCallback((): boolean => {
    const selected = themesRef.current[selectedIndexRef.current];
    if (!selected) return false;
    cancelPreview();
    onCommitRef.current(selected.id);
    return true;
  }, [cancelPreview]);

  useImperativeHandle(ref, () => ({
    move,
    commit,
    cancelPreview,
  }), [cancelPreview, commit, move]);

  useEffect(() => {
    const preferredIndex = themes.findIndex((theme) => theme.id === committedThemeId);
    const nextIndex = preferredIndex >= 0 ? preferredIndex : 0;
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
    setHoveredIndex(null);
  }, [committedThemeId, themes]);

  useEffect(() => cancelPreview, [cancelPreview]);

  useLayoutEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    if (scrollBox.verticalScrollBar) scrollBox.verticalScrollBar.visible = false;
    if (themes.length === 0) return;
    const viewportHeight = Math.max(1, scrollBox.viewport?.height ?? height);
    if (selectedIndex < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedIndex);
    } else if (selectedIndex >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(selectedIndex - viewportHeight + 1);
    }
  }, [height, selectedIndex, themes.length]);

  const handleScroll = useCallback((event: ThemePickerScrollEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const delta = Math.max(1, Math.round(event.scroll?.delta ?? 1));
    const direction = event.scroll?.direction;
    if (direction === "down" || direction === "right") {
      move(delta);
    } else if (direction === "up" || direction === "left") {
      move(-delta);
    }
  }, [move]);

  if (themes.length === 0) {
    return (
      <Box height={height} paddingX={contentPadding}>
        <Text fg={paletteSubtleText}>{truncateText("No themes match", queryDisplayWidth)}</Text>
      </Box>
    );
  }

  return (
    <ScrollBox
      ref={scrollRef}
      flexDirection="column"
      height={height}
      scrollY
      focusable={false}
      {...(!nativePaneChrome ? { onMouseScroll: handleScroll } : {})}
    >
      {themes.map((theme, index) => {
        const selected = index === selectedIndex;
        const hovered = index === hoveredIndex && !selected;
        const current = theme.id === committedThemeId;
        const label = truncateText(theme.name, labelWidth);
        const trailing = current ? "current" : "";
        return (
          <Box
            key={theme.id}
            flexDirection="row"
            height={1}
            paddingX={contentPadding}
            backgroundColor={selected
              ? paletteSelectedBg
              : hovered
                ? paletteHoverBg
                : (nativePaneChrome ? panelBg : paletteBg)}
            onMouseMove={() => setHoveredIndex(index)}
            onMouseOut={() => setHoveredIndex(null)}
            onMouseDown={(event: any) => {
              event.stopPropagation?.();
              event.preventDefault?.();
              selectedIndexRef.current = index;
              setSelectedIndex(index);
              cancelPreview();
              onCommitRef.current(theme.id);
            }}
            {...(!nativePaneChrome ? { onMouseScroll: handleScroll } : {})}
            data-command-bar-row-selected={nativePaneChrome && selected ? "true" : undefined}
            style={nativePaneChrome ? { borderRadius: 6 } : undefined}
          >
            <Box width={labelWidth}>
              <Text
                fg={selected ? paletteSelectedText : paletteText}
                attributes={current ? TextAttributes.BOLD : undefined}
              >
                {label}
              </Text>
            </Box>
            <Box width={trailingWidth}>
              <Text fg={selected ? paletteSelectedText : paletteSubtleText}>
                {truncateText(trailing, trailingWidth)}
              </Text>
            </Box>
          </Box>
        );
      })}
    </ScrollBox>
  );
}));
