/**
 * Debounced, keyed batch queue for external file changes.
 *
 * Purpose: own the timer/queue/re-entrancy state machine that used to live
 * inline in `useExternalFileChanges`, where it had two defects that were
 * invisible because nothing could test it without React and a filesystem.
 *
 * Key decisions:
 *   - ONE scheduling path. The hook had two — `queueDirtyChange` and the
 *     `finally` re-schedule — and the second overwrote `batchTimeoutRef`
 *     without clearing the first. A change arriving during an open dialog
 *     therefore leaked a timer that unmount cleanup could no longer cancel, so
 *     it fired against a torn-down hook. `schedule()` always clears first.
 *   - Items are NOT lost when processing throws. The hook drained the queue
 *     before awaiting its dialog; a rejection from `message()` left the guard
 *     reset but the batch gone, so those conflicts were never re-surfaced and
 *     the user was never asked. Failed items are put back.
 *   - Requeue does not clobber. An item re-queued while processing was in
 *     flight is NEWER than the copy that failed, so it wins.
 *   - Retries are bounded (one). Beyond that the items stay queued for the
 *     next real event rather than driving an endless dialog loop.
 *   - `dispose()` is terminal and `cancel()` is not. Cleanup needs the former:
 *     cancelling cannot reach a batch that is already running, and that batch
 *     re-schedules from its own `finally`, so an open dialog at unmount re-armed
 *     a timer after cleanup had cancelled one.
 *
 * @coordinates-with hooks/useExternalFileChanges.ts — the only production consumer
 * @module services/files/externalChangeBatchQueue
 */

/** How many times a failed batch is retried automatically before it waits. */
const MAX_AUTO_RETRIES = 1;

export interface BatchQueue<T> {
  /** Queue `item` under `key`, replacing any earlier item with that key. */
  queue(key: string, item: T): void;
  /** Cancel the pending timer. Queued items are KEPT, not dropped. */
  cancel(): void;
  /**
   * Terminal shutdown: no further work runs, ever.
   *
   * `cancel()` cannot serve as cleanup, because it cannot reach a batch that is
   * already running: that batch re-schedules from its own `finally` whenever
   * anything is pending, so a dialog open at unmount re-armed a timer after
   * cleanup had cancelled one, and it fired into a torn-down consumer. This
   * clears the timer, drops the queue, and latches — a late completion finds
   * the queue disposed and stops.
   */
  dispose(): void;
  /** Number of items currently waiting. */
  size(): number;
}

export interface BatchQueueOptions<T> {
  debounceMs: number;
  /** Handle one drained batch. Rejections requeue the batch. */
  process: (items: T[]) => Promise<void>;
  /** Report a rejected batch. Called once per failure. */
  onError: (error: unknown) => void;
}

export function createBatchQueue<T>({
  debounceMs,
  process,
  onError,
}: BatchQueueOptions<T>): BatchQueue<T> {
  const pending = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let processing = false;
  let consecutiveFailures = 0;
  let disposed = false;

  function schedule(): void {
    // Always clear first — the single-timer invariant this module exists for.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, debounceMs);
  }

  async function run(): Promise<void> {
    if (pending.size === 0) return;
    if (processing) {
      // A dialog is still open. Come back rather than re-entering it.
      schedule();
      return;
    }

    processing = true;
    const drained = new Map(pending);
    pending.clear();

    try {
      await process([...drained.values()]);
      consecutiveFailures = 0;
    } catch (error) {
      // Put the batch back before reporting, so a handler that inspects the
      // queue sees the true state. Keys re-queued while we were awaiting hold
      // fresher data and are not overwritten.
      for (const [key, item] of drained) {
        if (!pending.has(key)) pending.set(key, item);
      }
      consecutiveFailures += 1;
      onError(error);
    } finally {
      processing = false;
      // A dispose that landed while this batch was in flight wins: drop
      // whatever the catch put back rather than re-arming for a consumer that
      // no longer exists.
      if (disposed) pending.clear();
      // Anything queued during processing — or put back by the catch — gets
      // another pass, up to the retry bound.
      if (pending.size > 0 && consecutiveFailures <= MAX_AUTO_RETRIES) {
        schedule();
      }
    }
  }

  return {
    queue(key, item) {
      if (disposed) return;
      pending.set(key, item);
      schedule();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    // Two guards, and only two: `queue()` refuses new work, and the `finally`
    // below drops whatever the catch put back. Guards in `schedule()` and at
    // the top of `run()` were also written, and removed — `dispose()` clears
    // the timer, so `run()` cannot start afterwards and `schedule()` cannot be
    // reached, which made them branches no test could distinguish. Untestable
    // defence is indistinguishable from dead code.
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
    size: () => pending.size,
  };
}
