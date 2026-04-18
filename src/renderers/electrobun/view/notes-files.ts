import { backendRequest } from "./backend-rpc";

export interface QuickNoteEntry {
  id: string;
  title: string;
}

export class NotesFiles {
  constructor(private readonly dataDir: string) {}

  async load(symbol: string): Promise<string> {
    return backendRequest<string>("notes.load", {
      dataDir: this.dataDir,
      symbol,
    });
  }

  async save(symbol: string, notes: string): Promise<void> {
    await backendRequest("notes.save", {
      dataDir: this.dataDir,
      symbol,
      notes,
    });
  }

  async delete(symbol: string): Promise<void> {
    await backendRequest("notes.delete", {
      dataDir: this.dataDir,
      symbol,
    });
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    return backendRequest<QuickNoteEntry[]>("notes.loadQuickNotesIndex", {
      dataDir: this.dataDir,
    });
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    await backendRequest("notes.saveQuickNotesIndex", {
      dataDir: this.dataDir,
      entries,
    });
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }
}
