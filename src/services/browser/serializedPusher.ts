/**
 * serializedPusher — push the LATEST desired value to the driver, one send at a
 * time, until the driver has acknowledged it.
 *
 * Purpose: the grant set and the AI policy are both "the driver must hold what
 * the frontend holds" mirrors, and both used to be pushed fire-and-forget. Two
 * rapid changes could complete out of order (the older, more permissive one
 * landing last), and a failed TIGHTENING push left the driver permanently more
 * permissive than the settings said. A pusher serializes sends, always sends the
 * newest value (intermediate values are skipped, never reordered), and retries a
 * failure with exponential backoff until it converges or the owner disposes it —
 * a revocation is never silently abandoned.
 *
 * Key decisions:
 *   - Latest-wins, not a queue: only the newest desired value matters to the
 *     driver, so an older one still waiting is dropped, not sent late.
 *   - Retry until disposed, with bounded backoff (100 ms → 8 s). A driver that is
 *     down for a while gets the value when it is back; the loop stops only when
 *     the owning session ends, so a torn-down session cannot land a stale value
 *     after its successor's push.
 *   - Reports every failure through `onFailure`; the caller decides how loud.
 *
 * @coordinates-with services/browser/grantSync — standing grants
 * @coordinates-with services/browser/browserAiPolicySync — the AI policy
 * @module services/browser/serializedPusher
 */

const BACKOFF_MS = [100, 200, 400, 800, 1_600, 3_200, 8_000] as const;

export interface SerializedPusher<T> {
  /** Make `value` the desired state and start (or continue) converging on it. */
  push: (value: T) => void;
  /** Stop: no further sends; an in-flight send completes but is not retried. */
  dispose: () => void;
  /** True once the driver acknowledged the most recent value. Test/diagnostic seam. */
  isConverged: () => boolean;
}

export function makeSerializedPusher<T>(
  send: (value: T) => Promise<void>,
  onFailure: (error: unknown, attempt: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): SerializedPusher<T> {
  let desired: T | null = null;
  let pending = false;
  let running = false;
  let disposed = false;
  let attempts = 0;

  async function drain(): Promise<void> {
    if (running) return; // the running loop re-reads `desired` after each send
    running = true;
    try {
      while (pending && !disposed) {
        const snapshot = desired as T;
        pending = false;
        try {
          await send(snapshot);
          attempts = 0;
        } catch (error) {
          if (disposed) return;
          if (pending) {
            attempts = 0; // a newer value supersedes this one — push that instead
            continue;
          }
          onFailure(error, ++attempts);
          pending = true; // re-queue the same value; never abandon a revocation
          await sleep(BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    push: (value) => {
      if (disposed) return;
      desired = value;
      pending = true;
      void drain();
    },
    dispose: () => {
      disposed = true;
      pending = false;
    },
    isConverged: () => !pending && !running,
  };
}
