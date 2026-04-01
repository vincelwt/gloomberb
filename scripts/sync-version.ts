import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const rootDir = join(import.meta.dir, "..");

export function syncVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
  const version = pkg.version;

  writeFileSync(
    join(rootDir, "src/version.ts"),
    `export const VERSION = "${version}";\n`,
  );
}

if (import.meta.main) {
  syncVersion();
}
