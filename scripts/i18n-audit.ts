/**
 * Static i18n audit: extracts every string-literal key passed to t() / tf()
 * and tc() across src/, then reports keys missing from the zh-CN dictionary
 * and dictionary entries no longer referenced anywhere.
 *
 * Usage:
 *   bun run scripts/i18n-audit.ts            # human-readable report
 *   bun run scripts/i18n-audit.ts --json     # machine-readable output
 *
 * Exit code is 1 when any referenced key is missing a translation, so this
 * can run in CI or gate an agent's work.
 */
import { readdir } from "fs/promises";
import { join } from "path";
import { zhCN } from "../src/i18n/zh-cn";

const SOURCE_ROOT = join(process.cwd(), "src");

// t("...") / tf("...") / tf('...') — first string-literal argument.
const CALL_PATTERN = /\bt[fc]?\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;
// tc("context", "text") needs both arguments to build the dictionary key.
const TC_PATTERN = /\btc\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*(["'])((?:\\.|(?!\3).)*)\3/g;

function unescape(raw: string, quote: string): string {
  return raw
    .replaceAll(`\\${quote}`, quote)
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replaceAll("\\\\", "\\")
    .replaceAll("\\n", "\n");
}

function isRuntimeSource(path: string): boolean {
  if (path.includes(".test.")) return false;
  if (path.includes("test-helpers")) return false;
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

async function collectSourceFiles(dir: string, result: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(path, result);
    else if (entry.isFile() && isRuntimeSource(path)) result.push(path);
  }
  return result;
}

const referenced = new Map<string, string[]>(); // key -> files
const files = await collectSourceFiles(SOURCE_ROOT);

for (const file of files) {
  const source = await Bun.file(file).text();
  const relative = file.slice(process.cwd().length + 1);

  for (const match of source.matchAll(TC_PATTERN)) {
    const key = unescape(match[2]!, match[1]!) + unescape(match[4]!, match[3]!);
    referenced.set(key, [...(referenced.get(key) ?? []), relative]);
  }
  for (const match of source.matchAll(CALL_PATTERN)) {
    // Skip tc() here — it was handled above with its combined key.
    if (source.slice(match.index!, match.index! + 3) === "tc(") continue;
    const key = unescape(match[2]!, match[1]!);
    if (!key) continue;
    referenced.set(key, [...(referenced.get(key) ?? []), relative]);
  }
}

const missing = [...referenced.keys()].filter((key) => !(key in zhCN)).sort();
const unused = Object.keys(zhCN).filter((key) => !referenced.has(key)).sort();

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify({
    calls: referenced.size,
    dictionaryEntries: Object.keys(zhCN).length,
    missing,
    unused,
  }, null, 2));
} else {
  console.log(`t()/tf()/tc() distinct keys referenced: ${referenced.size}`);
  console.log(`zh-CN dictionary entries: ${Object.keys(zhCN).length}`);
  console.log(`\nMissing translations: ${missing.length}`);
  for (const key of missing) {
    console.log(`  "${key}"  ← ${[...new Set(referenced.get(key))].slice(0, 2).join(", ")}`);
  }
  console.log(`\nDictionary entries not referenced by any t()/tf()/tc() call: ${unused.length}`);
  if (unused.length > 0 && process.argv.includes("--verbose")) {
    for (const key of unused) console.log(`  "${key}"`);
  } else if (unused.length > 0) {
    console.log("  (pass --verbose to list; many flow through dynamic sinks like pane names, so unused ≠ deletable)");
  }
}

if (missing.length > 0) process.exit(1);
