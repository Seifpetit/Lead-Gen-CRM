/**
 * Tells the live stream that something about a user's runs changed (a sentence, a count, a
 * status), so it sends fresh data now instead of at its next tick. In memory and per process:
 * the stream also re-reads on a timer, so a missed notice only delays an update.
 */
export class RunChanges {
  private readonly listeners = new Map<string, Set<() => void>>();

  notify(userId: string): void {
    for (const fn of this.listeners.get(userId) ?? []) fn();
  }

  /** Calls `fn` on every change for this user; returns the way to stop. */
  subscribe(userId: string, fn: () => void): () => void {
    const set = this.listeners.get(userId) ?? new Set();
    set.add(fn);
    this.listeners.set(userId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }
}
