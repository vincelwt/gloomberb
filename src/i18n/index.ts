import { zhCN } from "./zh-cn";

export type AppLanguage = "en" | "zh-CN";

const DICTIONARIES: Record<Exclude<AppLanguage, "en">, Record<string, string>> = {
  "zh-CN": zhCN,
};

function normalizeLanguageTag(tag: string): AppLanguage | null {
  const lower = tag.trim().toLowerCase();
  if (!lower) return null;
  if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) return "en";
  if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) return "zh-CN";
  return null;
}

function detectLanguage(): AppLanguage {
  try {
    if (typeof process !== "undefined" && process.env) {
      const env = process.env;
      const override = env.GLOOMBERB_LANG && normalizeLanguageTag(env.GLOOMBERB_LANG);
      if (override) return override;
      // Keep the test suite deterministic regardless of the host locale.
      if (env.NODE_ENV === "test") return "en";
      const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
      const fromLocale = normalizeLanguageTag(locale);
      if (fromLocale) return fromLocale;
    }
  } catch {
    // ignore and fall through
  }
  try {
    if (typeof navigator !== "undefined" && navigator.language) {
      const fromNavigator = normalizeLanguageTag(navigator.language);
      if (fromNavigator) return fromNavigator;
    }
  } catch {
    // ignore and fall through
  }
  return "en";
}

let currentLanguage: AppLanguage = detectLanguage();

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function setLanguage(language: AppLanguage): void {
  currentLanguage = language;
}

/**
 * Applies the persisted `language` config field once the app config is
 * available. An explicit GLOOMBERB_LANG env var still wins so a single run
 * can be forced into another language without touching the config.
 */
export function applyLanguageFromConfig(config: { language?: string } | null | undefined): void {
  try {
    if (typeof process !== "undefined" && process.env?.GLOOMBERB_LANG) return;
  } catch {
    // ignore
  }
  const configured = config?.language;
  if (!configured || configured === "auto") return;
  const normalized = normalizeLanguageTag(configured);
  if (normalized) currentLanguage = normalized;
}

/**
 * Applies an explicit user language choice at runtime (from the LANG
 * command). "auto" re-runs environment detection.
 */
export function applyLanguagePreference(preference: "auto" | "en" | "zh-CN"): void {
  currentLanguage = preference === "auto" ? detectLanguage() : preference;
}

/**
 * Translates a user-visible string. Keys are the original English text;
 * anything missing from the active dictionary falls back to English, so
 * untranslated or dynamic strings render unchanged.
 */
export function t(text: string): string {
  if (currentLanguage === "en") return text;
  return DICTIONARIES[currentLanguage][text] ?? text;
}

/**
 * Context-scoped translation for English homonyms (gettext msgctxt style).
 * Dictionary entries use the concatenated key of context and text; falls back to the
 * plain entry, then to the English text. Example: "Options" as a picker
 * heading (选项) vs. the Options plugin (期权).
 */
export function tc(context: string, text: string): string {
  if (currentLanguage === "en") return text;
  const dictionary = DICTIONARIES[currentLanguage];
  return dictionary[`${context}${text}`] ?? dictionary[text] ?? text;
}

/**
 * Translates a template with `{placeholder}` params, e.g.
 * `tf("Published {date}", { date })`. The template (with placeholders intact)
 * is the dictionary key; params are substituted after lookup.
 */
export function tf(template: string, params: Record<string, string | number>): string {
  const translated = t(template);
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => (
    key in params ? String(params[key]) : match
  ));
}
