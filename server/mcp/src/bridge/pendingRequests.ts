/**
 * In-flight request registry.
 *
 * Owns request-id generation, the id → pending-promise map, and each request's
 * response timeout. Correlation is by envelope `id`; a response whose id is
 * unknown (late reply after a timeout, or a stray frame) is logged and dropped.
 */

import type { BridgeRequest, BridgeResponse } from './types.js';
import type { Logger } from './websocketConfig.js';
import type { WsMessage } from './wsProtocol.js';

/**
 * Pending request waiting for response.
 */
interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingRequestRegistry {
  private readonly pending: Map<string, PendingRequest> = new Map();
  private requestId = 0;

  constructor(
    private readonly requestTimeout: number,
    private readonly logger: Logger
  ) {}

  /**
   * Generate a unique request ID.
   */
  private nextRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  /**
   * Write a request onto the wire and track it until its response arrives.
   *
   * `send` is invoked synchronously; if it throws (socket gone, serialization
   * failure) the request is untracked again and the promise rejects — no timer
   * is left behind.
   */
  dispatch<T = unknown>(
    request: BridgeRequest,
    send: (payload: string) => void
  ): Promise<BridgeResponse<T>> {
    const id = this.nextRequestId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${request.type}`));
      }, this.requestTimeout);

      this.pending.set(id, {
        resolve: resolve as (response: BridgeResponse) => void,
        reject,
        timer,
      });

      const message: WsMessage = {
        id,
        type: 'request',
        payload: request,
      };

      try {
        send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Resolve the request matching an incoming response envelope.
   */
  settle(message: WsMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.logger.warn('Received response for unknown request:', message.id);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    pending.resolve(message.payload as BridgeResponse);
  }

  /**
   * Reject every in-flight request with `message` and clear their timers.
   */
  rejectAll(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }
}
