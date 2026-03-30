import { unlink, readFile, writeFile } from "fs/promises";
import { join } from "path";

export interface QuickNoteEntry {
  id: string;
  title: string;
}

const QUICK_NOTES_INDEX = "__quick-notes-index__";

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

  private indexPath(): string {
    return join(this.dataDir, `${QUICK_NOTES_INDEX}.json`);
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    try {
      const raw = await readFile(this.indexPath(), "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    await writeFile(this.indexPath(), JSON.stringify(entries), "utf-8");
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }
}
