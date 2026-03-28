import { unlink, readFile, writeFile } from "fs/promises";
import { join } from "path";

export class NotesFiles {
  constructor(private readonly dataDir: string) {}

  private pathFor(symbol: string): string {
    return join(this.dataDir, `${symbol}.md`);
  }

  async load(symbol: string): Promise<string> {
    try {
      return await readFile(this.pathFor(symbol), "utf-8");
    } catch {
      return "";
    }
  }

  async save(symbol: string, notes: string): Promise<void> {
    await writeFile(this.pathFor(symbol), notes || "", "utf-8");
  }

  async delete(symbol: string): Promise<void> {
    try {
      await unlink(this.pathFor(symbol));
    } catch {
      // ignore missing files
    }
  }
}
