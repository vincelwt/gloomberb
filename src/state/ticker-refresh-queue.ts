export interface TickerRefreshTask {
  key: string;
  priority: number;
  run: () => Promise<void>;
}

export class TickerRefreshQueue {
  private active = 0;
  private paused = false;
  private readonly pendingKeys = new Set<string>();
  private readonly queue: TickerRefreshTask[] = [];

  constructor(private readonly concurrency = 3) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  enqueue(task: TickerRefreshTask): void {
    if (this.pendingKeys.has(task.key)) return;
    this.pendingKeys.add(task.key);
    this.queue.push(task);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.pump();
  }

  private pump(): void {
    if (this.paused) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active += 1;
      void next.run().finally(() => {
        this.active -= 1;
        this.pendingKeys.delete(next.key);
        this.pump();
      });
    }
  }
}
