interface StructuredEventResult {
  transcript: string;
  terminalError: string | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => stringValue(objectValue(entry)?.text) ?? "")
    .filter(Boolean)
    .join("");
}

export class AiStructuredStreamParser {
  private buffer = "";
  private claudeTranscript = "";
  private claudeSawDeltas = false;
  private piTranscript = "";
  private piSawDeltas = false;
  private readonly codexItems = new Map<string, string>();
  private readonly codexItemOrder: string[] = [];
  private terminalError: string | null = null;

  constructor(private readonly providerId: string) {}

  push(chunk: string): StructuredEventResult {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.parseLine(line);
    return this.result();
  }

  finish(): StructuredEventResult {
    if (this.buffer.trim()) this.parseLine(this.buffer);
    this.buffer = "";
    return this.result();
  }

  private parseLine(line: string): void {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const label = this.providerId === "claude"
        ? "Claude"
        : this.providerId === "codex"
          ? "Codex"
          : this.providerId === "pi"
            ? "Pi"
            : this.providerId;
      throw new Error(`${label} returned malformed structured output.`);
    }
    const event = objectValue(parsed);
    if (!event) return;
    if (this.providerId === "claude") this.parseClaude(event);
    if (this.providerId === "codex") this.parseCodex(event);
    if (this.providerId === "pi") this.parsePi(event);
  }

  private parseClaude(event: Record<string, unknown>): void {
    const nestedEvent = event.type === "stream_event" ? objectValue(event.event) : event;
    const delta = nestedEvent?.type === "content_block_delta" ? objectValue(nestedEvent.delta) : null;
    if (delta?.type === "text_delta") {
      this.claudeSawDeltas = true;
      this.claudeTranscript += stringValue(delta.text) ?? "";
      return;
    }

    if (event.type === "assistant" && !this.claudeSawDeltas) {
      const snapshot = contentText(objectValue(event.message)?.content);
      if (snapshot) this.claudeTranscript = snapshot;
      return;
    }

    if (event.type === "result") {
      const result = stringValue(event.result);
      if (event.is_error === true || event.subtype !== "success") {
        this.terminalError = result ?? "Claude failed to complete the request.";
      } else if (!this.claudeTranscript && result) {
        this.claudeTranscript = result;
      }
    }
  }

  private parseCodex(event: Record<string, unknown>): void {
    if (event.type === "error" || event.type === "turn.failed") {
      const error = objectValue(event.error);
      this.terminalError = stringValue(event.message)
        ?? stringValue(error?.message)
        ?? "Codex failed to complete the request.";
      return;
    }
    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return;
    const item = objectValue(event.item);
    if (item?.type !== "agent_message") return;
    const id = stringValue(item.id) ?? `agent-message-${this.codexItemOrder.length}`;
    if (!this.codexItems.has(id)) this.codexItemOrder.push(id);
    this.codexItems.set(id, stringValue(item.text) ?? "");
  }

  private parsePi(event: Record<string, unknown>): void {
    if (event.type === "message_update") {
      const assistantMessageEvent = objectValue(event.assistantMessageEvent);
      if (assistantMessageEvent?.type === "text_delta") {
        this.piSawDeltas = true;
        this.piTranscript += stringValue(assistantMessageEvent.delta) ?? "";
      }
      return;
    }
    if (event.type === "message_end" && !this.piSawDeltas) {
      const message = objectValue(event.message);
      if (message?.role === "assistant") {
        const snapshot = contentText(message.content);
        if (snapshot) this.piTranscript = snapshot;
      }
      return;
    }
    if (event.type === "error") {
      this.terminalError = stringValue(event.message) ?? "Pi failed to complete the request.";
    }
  }

  private result(): StructuredEventResult {
    let transcript: string;
    if (this.providerId === "codex") {
      transcript = this.codexItemOrder.map((id) => this.codexItems.get(id) ?? "").filter(Boolean).join("\n\n");
    } else if (this.providerId === "pi") {
      transcript = this.piTranscript;
    } else {
      transcript = this.claudeTranscript;
    }
    return { transcript, terminalError: this.terminalError };
  }
}
