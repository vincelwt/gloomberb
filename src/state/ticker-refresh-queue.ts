
import { debugLog } from "../utils/debug-log";
import { measurePerfAsync } from "../utils/perf-marks";

export interface TickerRefreshTask {
  key: string;
  priority: number;
  run: () => Promise<void>;
}

interface QueuedTickerRefreshTask extends TickerRefreshTask {
  enqueuedAt: number;
}

const TASK_WARN_MS = 500;
const WAIT_WARN_MS = 1000;
const refreshQueueLog = debugLog.createLogger("refresh-queue");

export class TickerRefreshQueue {
  private active = 0;
  private paused = false;
  private readonly pendingKeys = new Set<string>();
  private readonly queue: QueuedTickerRefreshTask[] = [];

  constructor(private readonly concurrency = 3) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  enqueue(task: TickerRefreshTask): void {
    if (this.pendingKeys.has(task.key)) return;
    this.pendingKeys.add(task.key);
    this.queue.push({ ...task, enqueuedAt: Date.now() });
    this.queue.sort((a, b) => a.priority - b.priority);
    refreshQueueLog.info("task queued", {
      key: task.key,
      priority: task.priority,
      active: this.active,
      pending: this.queue.length,
      paused: this.paused,
    });
    this.pump();
  }

  private pump(): void {
    if (this.paused) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active += 1;
      const waitMs = Date.now() - next.enqueuedAt;
      refreshQueueLog.info("task started", {
        key: next.key,
        priority: next.priority,
        waitMs,
        active: this.active,
        pending: this.queue.length,
      });
      void measurePerfAsync(
        `refresh-queue.${next.key}`,
        next.run,
        {
          key: next.key,
          priority: next.priority,
          waitMs,
        },
      ).finally(() => {
        const durationMs = Date.now() - next.enqueuedAt - waitMs;
        const payload = {
          key: next.key,
          priority: next.priority,
          waitMs,
          durationMs,
          active: this.active - 1,
          pending: this.queue.length,
        };
        if (durationMs >= TASK_WARN_MS || waitMs >= WAIT_WARN_MS) {
          refreshQueueLog.warn("task finished slowly", payload);
        } else {
          refreshQueueLog.info("task finished", payload);
        }
        this.active -= 1;
        this.pendingKeys.delete(next.key);
        this.pump();
      });
    }
  }
}
