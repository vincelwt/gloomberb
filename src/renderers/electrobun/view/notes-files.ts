import { NOTES_FILES_CAPABILITY_ID } from "../../../capabilities";
import { backendRequest } from "./backend-rpc";

export interface QuickNoteEntry {
  id: string;
  title: string;
  updatedAt?: number;
}

export class NotesFiles {
  constructor(private readonly dataDir: string) {}

  private invoke<T>(operationId: string, payload: Record<string, unknown> = {}): Promise<T> {
    return backendRequest<T>("capability.invoke", {
      capabilityId: NOTES_FILES_CAPABILITY_ID,
      operationId,
      payload: {
        dataDir: this.dataDir,
        ...payload,
      },
    });
  }

  async load(symbol: string): Promise<string> {
    return this.invoke<string>("load", {
      symbol,
    });
  }

  async save(symbol: string, notes: string): Promise<void> {
    await this.invoke("save", {
      symbol,
      notes,
    });
  }

  async delete(symbol: string): Promise<void> {
    await this.invoke("delete", {
      symbol,
    });
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    return this.invoke<QuickNoteEntry[]>("loadQuickNotesIndex");
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    await this.invoke("saveQuickNotesIndex", {
      entries,
    });
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }
}
