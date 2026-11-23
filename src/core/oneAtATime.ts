/**
 * One change at a time. Apply, installs and preset edits that install all call VS Code's CLI on the same profiles and
 * write the same files, so a second one started while the first still runs (a second click while the first was still
 * reading profiles, seen 2026-11-23: three applies installing the same extensions at once) is refused, not queued.
 * Pure: the caller says what to show. Per window (each window runs its own extension host).
 */
export type OneAtATimeResult<T> = { ran: true; value: T } | { ran: false; running: string };

export class OneAtATime {
  private running: string | undefined;

  /** What is running now, or undefined. */
  get current(): string | undefined {
    return this.running;
  }

  /** Runs `fn` unless something else is running; then says what. Frees the slot when `fn` ends, also on a throw. */
  async run<T>(label: string, fn: () => Promise<T>): Promise<OneAtATimeResult<T>> {
    if (this.running !== undefined) return { ran: false, running: this.running };
    this.running = label;
    try {
      return { ran: true, value: await fn() };
    } finally {
      this.running = undefined;
    }
  }
}
