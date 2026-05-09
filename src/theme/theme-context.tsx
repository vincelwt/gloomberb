import { createContext, useContext, useMemo, type ReactNode } from "react";
import { colors, getCurrentThemeId, syncTheme } from "./colors";
import type { Theme } from "./themes";

type ThemeColors = Omit<Theme, "name" | "description">;

interface ThemeContextValue {
  themeId: string;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ themeId, children }: { themeId: string; children: ReactNode }) {
  syncTheme(themeId);
  const value = useMemo(() => ({ themeId, colors }), [themeId]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeId(): string {
  return useContext(ThemeContext)?.themeId ?? getCurrentThemeId();
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext)?.colors ?? colors;
}
