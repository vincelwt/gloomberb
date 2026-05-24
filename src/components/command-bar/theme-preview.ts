import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  applyTheme,
  clearTransientThemePreview,
  getCurrentThemeId,
  previewTheme,
} from "../../theme/colors";
import type { AppAction } from "../../state/app/context";
import type { ThemePickerHandle } from "./theme-picker";

interface CommandBarThemePreviewOptions {
  dispatch: (action: AppAction) => void;
  getCommittedThemeId: () => string;
  themePickerRef: RefObject<ThemePickerHandle | null>;
}

export function useCommandBarThemePreview({
  dispatch,
  getCommittedThemeId,
  themePickerRef,
}: CommandBarThemePreviewOptions) {
  const rootThemeBaseIdRef = useRef<string | null>(null);
  const currentThemePreviewRef = useRef<string | null>(null);

  const applyThemePreview = useCallback((themeId: string | null) => {
    const committedThemeId = getCommittedThemeId();
    const preview = themeId && themeId !== committedThemeId ? themeId : null;
    if (preview) {
      previewTheme(preview);
    } else {
      clearTransientThemePreview();
      if (getCurrentThemeId() !== committedThemeId) {
        applyTheme(committedThemeId);
      }
    }
    if (currentThemePreviewRef.current !== preview) {
      currentThemePreviewRef.current = preview;
      dispatch({ type: "PREVIEW_THEME", theme: preview });
    }
  }, [dispatch, getCommittedThemeId]);

  const clearThemePreview = useCallback((themeId: string | null | undefined) => {
    themePickerRef.current?.cancelPreview();
    const targetThemeId = themeId ?? getCommittedThemeId();
    if (!targetThemeId) return;
    clearTransientThemePreview();
    if (getCurrentThemeId() !== targetThemeId) {
      applyTheme(targetThemeId);
    }
    if (currentThemePreviewRef.current !== null) {
      currentThemePreviewRef.current = null;
      dispatch({ type: "PREVIEW_THEME", theme: null });
    }
  }, [dispatch, getCommittedThemeId, themePickerRef]);

  const restoreThemePreview = useCallback(() => {
    clearThemePreview(rootThemeBaseIdRef.current);
  }, [clearThemePreview]);

  const commitTheme = useCallback((themeId: string) => {
    themePickerRef.current?.cancelPreview();
    clearTransientThemePreview();
    if (getCurrentThemeId() !== themeId) {
      applyTheme(themeId);
    }
    currentThemePreviewRef.current = null;
    dispatch({ type: "SET_THEME", theme: themeId });
  }, [dispatch, themePickerRef]);

  useEffect(() => {
    return () => {
      themePickerRef.current?.cancelPreview();
      clearTransientThemePreview();
    };
  }, [themePickerRef]);

  return {
    applyThemePreview,
    clearThemePreview,
    commitTheme,
    restoreThemePreview,
    rootThemeBaseIdRef,
  };
}
