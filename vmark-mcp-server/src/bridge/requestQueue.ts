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
      const timer = setTimeout(() => {
        // Only time out while the request is still queued. Once
        // flush() has taken ownership of it (idx === -1), the
        // in-flight send governs the wait via its own timeout —
        // rejecting here would spuriously fail an operation that is still
        // succeeding (#959).
        const idx = this.queue.findIndex((q) => q.request === request);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error(`Queued request ${request.type} timed out`));
        }
      }, this.requestTimeout);

      this.queue.push({
        request,
        resolve: (value: BridgeResponse) => { clearTimeout(timer); (resolve as (response: BridgeResponse) => void)(value); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      });

      this.logger.debug(`Request queued (queue size: ${this.queue.length})`);
    });
  }

  /**
   * Flush queued requests after reconnection.
   *
   * The queue is detached BEFORE the first send so entries queued during the
   * flush are not drained twice.
   */
  async flush(send: (request: BridgeRequest) => Promise<BridgeResponse>): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    this.logger.debug(`Flushing ${this.queue.length} queued requests`);
    const queue = [...this.queue];
    this.queue = [];

    for (const { request, resolve, reject } of queue) {
      try {
        const response = await send(request);
        resolve(response);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
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
