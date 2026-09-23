/**
 * Priority semaphore in front of each model backend. Ollama serves
 * OLLAMA_NUM_PARALLEL requests at once; anything beyond that waits here, and
 * Quick-mode calls (priority 1) jump ahead of council calls (priority 10).
 */
export const PRIORITY = { quick: 1, council: 10 } as const;

interface Waiter {
  priority: number;
  seq: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
}

export class PriorityGate {
  private active = 0;
  private seq = 0;
  private waiters: Waiter[] = [];

  constructor(private slots: number) {}

  setSlots(n: number) {
    this.slots = Math.max(1, n);
    this.drain();
  }

  get stats() {
    return { active: this.active, waiting: this.waiters.length, slots: this.slots };
  }

  /** True if a caller would have to wait right now. */
  get busy() {
    return this.active >= this.slots || this.waiters.length > 0;
  }

  /** How many queued callers would be served before a new caller at this priority. */
  positionFor(priority: number) {
    return this.waiters.filter((w) => w.priority <= priority).length;
  }

  acquire(priority: number, signal?: AbortSignal): Promise<() => void> {
    if (!this.busy) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { priority, seq: this.seq++, resolve, reject };
      this.waiters.push(waiter);
      this.waiters.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      signal?.addEventListener('abort', () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error('aborted'));
        }
      });
    });
  }

  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  private drain() {
    while (this.active < this.slots && this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      this.active++;
      next.resolve(this.releaser());
    }
  }
}
