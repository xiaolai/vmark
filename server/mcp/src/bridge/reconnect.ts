/**
 * Reconnect loop: attempt budget, exponential backoff, and the two ways the
 * loop is re-entered — a lost connection, or a send() that arrives after the
 * budget was already spent.
 *
 * The budget counts REAL connection failures only; port-discovery polls are
 * deliberately not charged against it (see WebSocketBridge.connect()).
 */

import type { Logger } from './websocketConfig.js';

/** What the loop needs from the bridge that owns it. */
export interface ReconnectHost {
  /** Start a fresh attempt. Routed through the bridge so each retry re-resolves the port. */
  connect: () => Promise<void>;
  /** Auto-reconnect is enabled AND the user has not called disconnect(). */
  mayRetry: () => boolean;
  /** Budget spent — nothing will reconnect, so drain whatever is still waiting. */
  onExhausted: () => void;
  /** Re-enter via the bridge so `scheduleReconnect` stays the loop's single entry point. */
  reschedule: () => void;
}

/** The reconnect knobs of `ResolvedBridgeConfig`. */
export interface ReconnectConfig {
  readonly maxReconnectAttempts: number;
  readonly reconnectDelay: number;
  readonly maxReconnectDelay: number;
}

export class ReconnectLoop {
  /** Failed attempts charged against the budget. */
  attempts = 0;
  /** Non-null only while a retry is armed. */
  timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ReconnectConfig,
    private readonly logger: Logger,
    private readonly host: ReconnectHost
  ) {}

  /** True while one more attempt is still permitted. */
  mayStillReconnect(): boolean {
    return this.host.mayRetry() && this.attempts < this.config.maxReconnectAttempts;
  }

  /** Cancel an armed retry (intentional disconnect). */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Schedule a reconnection attempt. */
  schedule(): void {
    if (this.timer) {
      return;
    }

    // Guard against exceeding max reconnect attempts.
    if (this.attempts >= this.config.maxReconnectAttempts) {
      this.logger.warn(
        `Max reconnect attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`
      );
      // Reject all queued requests since we won't reconnect
      this.host.onExhausted();
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.attempts),
      this.config.maxReconnectDelay
    );

    this.attempts++;
    this.logger.debug(
      `Scheduling reconnect attempt ${this.attempts}/${this.config.maxReconnectAttempts} in ${delay}ms`
    );

    this.timer = setTimeout(async () => {
      this.timer = null;

      try {
        await this.host.connect();
        this.logger.info('Reconnected successfully');
      } catch (error) {
        this.logger.debug(
          `Reconnect attempt ${this.attempts} failed:`,
          error instanceof Error ? error.message : error
        );
        // Schedule next attempt if allowed (connect no longer self-schedules)
        if (this.mayStillReconnect()) {
          this.host.reschedule();
        }
      }
    }, delay);
  }

  /**
   * Restart a loop the caller has established is idle: reset the budget and
   * start a fresh connection in the background.
   */
  revive(): void {
    this.attempts = 0;
    this.host.connect().catch(() => {
      // Failure handling (scheduling further retries) is owned by the
      // reconnect loop; this call only revives it.
    });
  }
}
