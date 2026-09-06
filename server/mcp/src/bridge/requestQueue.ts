/**
 * Outbound request queue used while the bridge is disconnected.
 *
 * Bounded, drop-oldest, newest-wins. Each entry carries its own wait timer so a
 * request that is never flushed still fails instead of hanging forever.
 */

import type { BridgeRequest, BridgeResponse } from './types.js';
import type { Logger } from './websocketConfig.js';

/**
 * Queued request waiting for reconnection.
 */
interface QueuedRequest {
  request: BridgeRequest;
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  /**
   * Set the moment `flush()` hands this entry to `send`. Until then the entry
   * is still WAITING and keeps its own deadline; after it, the in-flight send
   * governs the wait (#959).
   */
  dispatched: boolean;
  /** Set once settled, so the timer and the flush cannot both act on it. */
  settled: boolean;
}

export class OutboundRequestQueue {
  private queue: QueuedRequest[] = [];

  constructor(
    private readonly maxQueueSize: number,
    private readonly requestTimeout: number,
    private readonly logger: Logger
  ) {}

  /**
   * Queue a request for later when reconnected.
   */
  enqueue<T = unknown>(request: BridgeRequest): Promise<BridgeResponse<T>> {
    // Check queue capacity before creating the promise.
    // Since JS is single-threaded, the check + push below is atomic
    // (no other code runs between them), preventing queue overflow.
    if (this.queue.length >= this.maxQueueSize) {
      // Drop oldest requests to make room, preventing unbounded growth
      while (this.queue.length >= this.maxQueueSize) {
        const dropped = this.queue.shift();
        if (dropped) {
          dropped.reject(new Error(`Request dropped — queue overflow (type: ${dropped.request.type})`));
          this.logger.warn(`Dropped oldest queued request due to queue overflow: ${dropped.request.type}`);
        }
      }
    }

    return new Promise((resolve, reject) => {
      const entry: QueuedRequest = {
        request,
        dispatched: false,
        settled: false,
        resolve: (value: BridgeResponse) => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(timer);
          (resolve as (response: BridgeResponse) => void)(value);
        },
        reject: (err: Error) => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(timer);
          reject(err);
        },
      };

      const timer = setTimeout(() => {
        // Time out while the request is still WAITING. Once flush() has handed
        // it to `send` the in-flight timeout governs the wait, and rejecting
        // here would spuriously fail an operation that is still succeeding
        // (#959).
        //
        // Keyed on `dispatched`, NOT on membership of `this.queue`. flush()
        // used to detach the entire queue before sending anything, so every
        // entry lost its deadline the instant the flush began even though only
        // the first was actually in flight — a follower could then sit behind
        // many request timeouts with no deadline of its own (audit 20260906,
        // MCP-M01).
        if (entry.dispatched) return;
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) this.queue.splice(idx, 1);
        entry.reject(new Error(`Queued request ${request.type} timed out`));
      }, this.requestTimeout);

      this.queue.push(entry);

      this.logger.debug(`Request queued (queue size: ${this.queue.length})`);
    });
  }

  /**
   * Flush queued requests after reconnection.
   *
   * The queue is detached BEFORE the first send so entries queued during the
   * flush are not drained twice. Each entry keeps its OWN deadline until the
   * moment it is handed to `send` — the sends are serial, so only the first
   * entry is actually in flight while the rest are still waiting, and
   * releasing all of their deadlines at once left the followers able to wait
   * indefinitely (audit 20260906, MCP-M01).
   */
  async flush(send: (request: BridgeRequest) => Promise<BridgeResponse>): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    this.logger.debug(`Flushing ${this.queue.length} queued requests`);
    const queue = [...this.queue];
    this.queue = [];

    for (const entry of queue) {
      // Its deadline may have expired while it waited its turn behind a slow
      // predecessor. That rejection already settled the caller's promise.
      if (entry.settled) continue;
      // Ownership transfers HERE, one entry at a time.
      entry.dispatched = true;
      try {
        const response = await send(entry.request);
        entry.resolve(response);
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Drain the queue, rejecting every entry with `message`.
   */
  rejectAll(message: string): void {
    for (const queued of this.queue) {
      queued.reject(new Error(message));
    }
    this.queue = [];
  }
}
